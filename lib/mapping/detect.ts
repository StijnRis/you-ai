import { createHash } from "node:crypto";
import {
  collectFields,
  readRecords,
  sniffDelimiter,
  sniffFormat,
  type ExtractedFile,
  type Record_,
} from "@/lib/readers";
import type { MappingSpec } from "@/lib/mapping/spec";
import type { readerSchema } from "@/lib/mapping/spec";
import type { z } from "zod";

type ReaderSpec = z.infer<typeof readerSchema>;

/** What we can say about a file before any conversion is chosen. */
export type Detection = {
  path: string;
  format: ReaderSpec["format"];
  /** The reader settings that produced the sample, reused by an inferred spec. */
  reader: ReaderSpec;
  fields: string[];
  sample: Record_[];
  recordCount: number;
  /**
   * A hash of the file's *shape* — format plus field names. Two exports from
   * the same service on different days hash identically, which is what makes a
   * conversion reusable rather than one-shot.
   */
  fingerprint: string;
};

const SAMPLE_SIZE = 8;

/** Work out how to read a file, and what its records look like. */
export function detectFile(file: ExtractedFile): Detection {
  const format = sniffFormat(file.path, file.text);
  const reader = buildReader(format, file.text);
  const records = readRecords(file.text, reader);
  const fields = collectFields(records);

  return {
    path: file.path,
    format,
    reader,
    fields,
    sample: records.slice(0, SAMPLE_SIZE),
    recordCount: records.length,
    fingerprint: fingerprintOf(format, fields),
  };
}

function buildReader(format: ReaderSpec["format"], text: string): ReaderSpec {
  switch (format) {
    case "csv":
      return { format: "csv", delimiter: sniffDelimiter(text), header: true, skipLines: 0 };
    case "json":
      return { format: "json", recordsPath: findRecordsPath(text) };
    case "ndjson":
      return { format: "ndjson" };
    case "xml":
      return { format: "xml", recordsPath: findXmlRecordsPath(text) };
  }
}

/** Dot path to the biggest array in a JSON document. */
function findRecordsPath(text: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (Array.isArray(parsed)) return undefined;
  if (!parsed || typeof parsed !== "object") return undefined;

  let bestPath: string | undefined;
  let bestLength = 0;
  const walk = (node: unknown, path: string, depth: number) => {
    if (depth > 4 || !node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (Array.isArray(value)) {
        if (value.length > bestLength) {
          bestLength = value.length;
          bestPath = nextPath;
        }
      } else {
        walk(value, nextPath, depth + 1);
      }
    }
  };
  walk(parsed, "", 0);
  return bestPath;
}

/** The repeated element in an XML document, as a dot path from the root. */
function findXmlRecordsPath(text: string): string {
  // Count element names in the first chunk; the one that repeats most is the
  // record. Cheap, and right for every health/fitness export we've seen.
  const head = text.slice(0, 200_000);
  const counts = new Map<string, number>();
  for (const match of head.matchAll(/<([A-Za-z_][\w.-]*)[\s/>]/g)) {
    const name = match[1];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const rootMatch = head.match(/<([A-Za-z_][\w.-]*)[\s>]/);
  const root = rootMatch?.[1] ?? "root";
  counts.delete(root);

  let best = "";
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best ? `${root}.${best}` : root;
}

export function fingerprintOf(format: string, fields: string[]): string {
  const canonical = `${format}|${[...fields].sort().join(",")}`;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/**
 * Does a known conversion fit this file? Returns a score so the best of several
 * near-matches wins; 0 means it cannot handle the file at all.
 */
export function scoreSpec(spec: MappingSpec, detection: Detection, filename: string): number {
  if (spec.reader.format !== detection.format) return 0;

  const present = new Set(detection.fields);
  const required = spec.match.requiredFields;
  if (required.some((field) => !present.has(field))) return 0;

  let score = 1 + required.length;

  if (spec.match.filenamePattern) {
    try {
      if (new RegExp(spec.match.filenamePattern, "i").test(filename)) score += 5;
    } catch {
      // A malformed pattern just doesn't contribute.
    }
  }

  // Reward specs that read fields this file actually has, so a spec written for
  // a richer export doesn't beat one written for exactly this shape.
  const referenced = referencedPaths(spec);
  const hits = [...referenced].filter((path) => present.has(path.split(".")[0])).length;
  score += hits / Math.max(referenced.size, 1);

  return score;
}

function referencedPaths(spec: MappingSpec): Set<string> {
  const paths = new Set<string>();
  const add = (field?: { path?: string; coalesce?: string[] }) => {
    if (!field) return;
    if (field.path) paths.add(field.path);
    for (const path of field.coalesce ?? []) paths.add(path);
  };

  add(spec.timestamp);
  for (const emit of spec.emit) {
    add(emit.value);
    add(emit.valueText);
    add(emit.duration);
    add(emit.timestamp);
    add(emit.endTimestamp);
    add(emit.externalId);
    for (const entry of emit.meta ?? []) add(entry.field);
    if (emit.where) paths.add(emit.where.path);
    if (emit.skipWhen) paths.add(emit.skipWhen.path);
  }
  return paths;
}

/**
 * Trim a detection down to what a model needs to write a conversion, without
 * shipping it a whole export. Long values are truncated — the model needs the
 * shape, not the contents.
 */
export function detectionForPrompt(detection: Detection) {
  return {
    filename: detection.path,
    format: detection.format,
    reader: detection.reader,
    fields: detection.fields,
    recordCount: detection.recordCount,
    sampleRecords: detection.sample.slice(0, 5).map(truncateRecord),
  };
}

function truncateRecord(record: Record_): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && value.length > 120) {
      out[key] = `${value.slice(0, 120)}…`;
    } else if (value && typeof value === "object") {
      out[key] = JSON.stringify(value).slice(0, 200);
    } else {
      out[key] = value;
    }
  }
  return out;
}
