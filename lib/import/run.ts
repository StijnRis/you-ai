import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { importBlobs, imports, mappingSpecs, sources, specFingerprints } from "@/lib/db/schema";
import { detectFile, scoreSpec, type Detection } from "@/lib/mapping/detect";
import { builtinSpecs, ignoreReasonFor } from "@/lib/mapping/builtin";
import { inferSpec } from "@/lib/mapping/infer";
import { applySpecToRecords } from "@/lib/mapping/apply";
import { mappingSpecSchema, type MappingSpec } from "@/lib/mapping/spec";
import { extractFiles, readRecords } from "@/lib/readers";
import { ingestEvents } from "@/lib/events/ingest";

/**
 * The import service.
 *
 * One entry point for every data dump, whatever it came from. It works out the
 * file's shape, finds a conversion that already handles that shape, and only
 * asks the model to write a new one when nothing fits. Every conversion it
 * learns is saved against the fingerprint, so the second Fitbit export anyone
 * uploads costs nothing.
 */

export type ImportOutcome = {
  importId: string;
  filename: string;
  /** Absent when the file was recognised and deliberately not imported. */
  spec: MappingSpec | null;
  specId: string | null;
  matchKind: "fingerprint" | "builtin" | "inferred" | "skipped";
  /** Why a skipped file was skipped, for the import screen. */
  skipReason?: string;
  detection: Pick<Detection, "format" | "fields" | "recordCount" | "fingerprint"> | null;
  stats: {
    recordsRead: number;
    eventsBuilt: number;
    eventsStored: number;
    skipped: number;
    typesRegistered: number;
    dateRange: { from: string; to: string } | null;
    errors: { record: number; message: string }[];
  };
};

export type ImportInput = {
  userId: string;
  timezone: string;
  filename: string;
  data: Uint8Array;
  /** When false, an unrecognised format is rejected instead of being inferred. */
  allowInference?: boolean;
};

/**
 * How many files in one upload may reach the model. A real export is dozens of
 * files; recognising them costs nothing, but writing a conversion is a request
 * each. Everything matched by fingerprint or built-in is free and uncapped —
 * this only limits genuinely unknown shapes, which is where the cost is.
 */
const MAX_INFERENCES_PER_UPLOAD = 6;

export async function runImport(input: ImportInput): Promise<ImportOutcome[]> {
  const files = extractFiles(input.filename, input.data);
  if (files.length === 0) {
    throw new Error("No readable data files found. Supported: CSV, TSV, JSON, NDJSON, XML, ZIP.");
  }

  const outcomes: ImportOutcome[] = [];
  const budget = { inferences: MAX_INFERENCES_PER_UPLOAD };

  for (const file of files) {
    // Known exports carry a lot of bookkeeping. Recognising it as such beats
    // both failing on it and paying the model to invent a conversion for it.
    const skipReason = ignoreReasonFor(file.path);
    if (skipReason) {
      outcomes.push(await recordSkip(input, file.path, file.bytes, skipReason));
      continue;
    }

    try {
      outcomes.push(await importOneFile(input, file.path, file.text, file.bytes, budget));
    } catch (error) {
      // One unreadable member of an archive shouldn't sink the whole upload.
      await recordFailure(input, file.path, file.bytes, error);
    }
  }

  if (outcomes.length === 0) {
    throw new Error("None of the files in this upload could be converted. See the import log.");
  }
  return outcomes;
}

async function importOneFile(
  input: ImportInput,
  path: string,
  text: string,
  bytes: number,
  budget: { inferences: number },
): Promise<ImportOutcome> {
  const detection = detectFile({ path, text, bytes });

  if (detection.recordCount === 0) {
    throw new Error(`${path}: parsed as ${detection.format} but contained no records`);
  }

  const [importRow] = await db
    .insert(imports)
    .values({
      userId: input.userId,
      filename: path,
      byteSize: bytes,
      status: "applying",
      detection: {
        format: detection.format,
        fields: detection.fields,
        recordCount: detection.recordCount,
        fingerprint: detection.fingerprint,
        sample: detection.sample.slice(0, 3),
      },
    })
    .returning();

  await db.insert(importBlobs).values({
    importId: importRow.id,
    contentType: detection.format,
    content: text,
    encoding: "utf8",
  });

  try {
    const resolved = await resolveSpec(input, detection, path, budget);

    const source = await ensureSource(input.userId, resolved.spec);
    const records = readRecords(text, resolved.spec.reader);
    const applied = applySpecToRecords(records, resolved.spec, { timezone: input.timezone });
    const ingested = await ingestEvents(input.userId, applied.events, {
      sourceId: source.id,
      types: applied.types,
    });

    const stats: ImportOutcome["stats"] = {
      recordsRead: applied.recordsRead,
      eventsBuilt: applied.events.length,
      eventsStored: ingested.inserted,
      skipped: applied.skipped,
      typesRegistered: ingested.typesRegistered,
      dateRange: ingested.dateRange,
      errors: applied.errors.slice(0, 10),
    };

    await db
      .update(imports)
      .set({
        status: "done",
        mappingSpecId: resolved.specId,
        matchKind: resolved.matchKind,
        sourceId: source.id,
        stats,
        completedAt: new Date(),
      })
      .where(eq(imports.id, importRow.id));

    await db
      .update(mappingSpecs)
      .set({ timesUsed: sql`${mappingSpecs.timesUsed} + 1` })
      .where(eq(mappingSpecs.id, resolved.specId));

    return {
      importId: importRow.id,
      filename: path,
      spec: resolved.spec,
      specId: resolved.specId,
      matchKind: resolved.matchKind,
      detection: {
        format: detection.format,
        fields: detection.fields,
        recordCount: detection.recordCount,
        fingerprint: detection.fingerprint,
      },
      stats,
    };
  } catch (error) {
    await db
      .update(imports)
      .set({ status: "failed", error: messageOf(error), completedAt: new Date() })
      .where(eq(imports.id, importRow.id));
    throw error;
  }
}

/**
 * Find a conversion for this file shape, in order of cost:
 *   1. one already stored under this exact fingerprint — free, and the whole
 *      point of fingerprinting;
 *   2. a built-in whose required fields the file satisfies;
 *   3. ask the model to write one, then keep it.
 */
async function resolveSpec(
  input: ImportInput,
  detection: Detection,
  filename: string,
  budget: { inferences: number },
): Promise<{ spec: MappingSpec; specId: string; matchKind: ImportOutcome["matchKind"] }> {
  const [known] = await db
    .select({ spec: mappingSpecs })
    .from(specFingerprints)
    .innerJoin(mappingSpecs, eq(mappingSpecs.id, specFingerprints.specId))
    .where(
      and(
        eq(specFingerprints.fingerprint, detection.fingerprint),
        sql`${specFingerprints.userId} is null or ${specFingerprints.userId} = ${input.userId}`,
      ),
    )
    .orderBy(sql`${specFingerprints.userId} nulls first`)
    .limit(1);

  if (known) {
    return { spec: known.spec.spec, specId: known.spec.id, matchKind: "fingerprint" };
  }

  const builtin = bestBuiltin(detection, filename);
  if (builtin) {
    // A built-in that matched by scoring has now proved it handles this shape,
    // so remember it — the next file like this skips the scoring entirely.
    const saved = await persistSpec(builtin, "builtin", null);
    await rememberFingerprint(detection.fingerprint, saved.id, null);
    return { spec: builtin, specId: saved.id, matchKind: "builtin" };
  }

  if (input.allowInference === false) {
    throw new Error(
      `No conversion matches ${filename}, and writing new ones is switched off for this instance.`,
    );
  }

  if (budget.inferences <= 0) {
    throw new Error(
      `${filename}: no conversion matched, and this upload has already used its ` +
        `${MAX_INFERENCES_PER_UPLOAD} new-format allowance. Upload this file on its own to convert it.`,
    );
  }
  budget.inferences--;

  const inferred = await inferSpec(detection, { timezone: input.timezone });
  const spec = mappingSpecSchema.parse(inferred.spec);
  const saved = await persistSpec(spec, "inferred", input.userId, detection.fingerprint);
  await rememberFingerprint(detection.fingerprint, saved.id, input.userId);
  return { spec: saved.spec, specId: saved.id, matchKind: "inferred" };
}

async function rememberFingerprint(
  fingerprint: string,
  specId: string,
  userId: string | null,
): Promise<void> {
  await db
    .insert(specFingerprints)
    .values({ fingerprint, specId, userId })
    .onConflictDoNothing();
}

function bestBuiltin(detection: Detection, filename: string): MappingSpec | null {
  let best: MappingSpec | null = null;
  let bestScore = 0;
  for (const spec of builtinSpecs) {
    const score = scoreSpec(spec, detection, filename);
    if (score > bestScore) {
      best = spec;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Store the conversion itself. Built-ins are keyed by their own name and simply
 * refreshed; an inferred conversion whose key collides with an unrelated one
 * gets a suffix, because the key came from the model and it does not know what
 * else exists.
 */
async function persistSpec(
  spec: MappingSpec,
  origin: "builtin" | "inferred" | "manual",
  userId: string | null,
  fingerprint?: string,
) {
  const key =
    origin === "builtin" ? spec.key : await uniqueKey(spec.key, fingerprint ?? "");

  const [row] = await db
    .insert(mappingSpecs)
    .values({
      userId,
      key,
      name: spec.name,
      provider: spec.provider,
      origin,
      spec: { ...spec, key },
    })
    .onConflictDoUpdate({
      target: mappingSpecs.key,
      // Refresh the stored definition, but never change who owns it or where it
      // came from — a built-in must not become someone's private conversion.
      set: { spec: { ...spec, key }, name: spec.name, updatedAt: new Date() },
    })
    .returning();
  return row;
}

async function uniqueKey(preferred: string, fingerprint: string): Promise<string> {
  const [existing] = await db
    .select({ id: mappingSpecs.id })
    .from(mappingSpecs)
    .where(eq(mappingSpecs.key, preferred))
    .limit(1);

  if (!existing) return preferred;
  return `${preferred}.${fingerprint.slice(0, 6)}`;
}

/** Every import belongs to a source, so events can be traced back to a file. */
async function ensureSource(userId: string, spec: MappingSpec) {
  const [existing] = await db
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.userId, userId),
        eq(sources.kind, "import"),
        eq(sources.provider, spec.provider),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(sources)
    .values({
      userId,
      kind: "import",
      provider: spec.provider,
      label: spec.provider,
      config: {},
      lastSyncAt: new Date(),
    })
    .returning();
  return created;
}

/**
 * Note a file we recognise and chose not to import, so the import screen can
 * say so. Silence would look like a bug; a failure would be a lie.
 */
async function recordSkip(
  input: ImportInput,
  path: string,
  bytes: number,
  reason: string,
): Promise<ImportOutcome> {
  const [row] = await db
    .insert(imports)
    .values({
      userId: input.userId,
      filename: path,
      byteSize: bytes,
      status: "skipped",
      matchKind: "skipped",
      error: reason,
      completedAt: new Date(),
    })
    .returning({ id: imports.id });

  return {
    importId: row.id,
    filename: path,
    spec: null,
    specId: null,
    matchKind: "skipped",
    skipReason: reason,
    detection: null,
    stats: {
      recordsRead: 0,
      eventsBuilt: 0,
      eventsStored: 0,
      skipped: 0,
      typesRegistered: 0,
      dateRange: null,
      errors: [],
    },
  };
}

async function recordFailure(
  input: ImportInput,
  path: string,
  bytes: number,
  error: unknown,
): Promise<void> {
  await db.insert(imports).values({
    userId: input.userId,
    filename: path,
    byteSize: bytes,
    status: "failed",
    error: messageOf(error),
    completedAt: new Date(),
  });
}

/**
 * Re-run a stored import with a conversion the user has since edited. This is
 * why the uploaded bytes are kept: correcting a mapping shouldn't mean digging
 * the export out of your downloads folder again.
 */
export async function reapplyImport(params: {
  userId: string;
  timezone: string;
  importId: string;
  spec: MappingSpec;
}): Promise<ImportOutcome["stats"]> {
  const [row] = await db
    .select({ importRow: imports, blob: importBlobs })
    .from(imports)
    .innerJoin(importBlobs, eq(importBlobs.importId, imports.id))
    .where(and(eq(imports.id, params.importId), eq(imports.userId, params.userId)))
    .limit(1);

  if (!row) throw new Error("Import not found, or its uploaded file has been cleaned up.");

  const records = readRecords(row.blob.content, params.spec.reader);
  const applied = applySpecToRecords(records, params.spec, { timezone: params.timezone });
  const ingested = await ingestEvents(params.userId, applied.events, {
    sourceId: row.importRow.sourceId,
    types: applied.types,
  });

  const stats: ImportOutcome["stats"] = {
    recordsRead: applied.recordsRead,
    eventsBuilt: applied.events.length,
    eventsStored: ingested.inserted,
    skipped: applied.skipped,
    typesRegistered: ingested.typesRegistered,
    dateRange: ingested.dateRange,
    errors: applied.errors.slice(0, 10),
  };

  await db
    .update(imports)
    .set({ status: "done", stats, completedAt: new Date() })
    .where(eq(imports.id, params.importId));

  return stats;
}

/** Preview a conversion against a stored upload without writing any events. */
export async function previewSpec(params: {
  userId: string;
  timezone: string;
  importId: string;
  spec: MappingSpec;
}) {
  const [row] = await db
    .select({ blob: importBlobs })
    .from(imports)
    .innerJoin(importBlobs, eq(importBlobs.importId, imports.id))
    .where(and(eq(imports.id, params.importId), eq(imports.userId, params.userId)))
    .limit(1);

  if (!row) throw new Error("Import not found.");

  const records = readRecords(row.blob.content, params.spec.reader).slice(0, 25);
  return applySpecToRecords(records, params.spec, { timezone: params.timezone });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
