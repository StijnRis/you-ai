import { getPath, readRecords, type Record_ } from "@/lib/readers";
import { fromWallClock, localDateOf } from "@/lib/events/time";
import type {
  EmitSpec,
  FieldSpec,
  MappingSpec,
  Transform,
  TypeMeta,
  WhereSpec,
} from "@/lib/mapping/spec";

/** An event ready for the store, before it gets a user or a source. */
export type NormalizedEvent = {
  typeKey: string;
  startedAt: Date;
  endedAt: Date | null;
  durationS: number | null;
  value: number | null;
  valueText: string | null;
  localDate: string;
  meta: Record<string, unknown>;
  dedupeKey: string;
};

export type ApplyResult = {
  events: NormalizedEvent[];
  /** Type keys the spec introduced, with the metadata to register them under. */
  types: Map<string, TypeMeta>;
  recordsRead: number;
  skipped: number;
  errors: { record: number; message: string }[];
};

export type ApplyOptions = {
  timezone: string;
  /** Stop after this many events — used to build the preview cheaply. */
  limit?: number;
};

/** Run a stored conversion over a file's text, producing events. */
export function applySpec(text: string, spec: MappingSpec, options: ApplyOptions): ApplyResult {
  const records = readRecords(text, spec.reader);
  return applySpecToRecords(records, spec, options);
}

export function applySpecToRecords(
  records: Record_[],
  spec: MappingSpec,
  options: ApplyOptions,
): ApplyResult {
  const events: NormalizedEvent[] = [];
  const types = new Map<string, TypeMeta>();
  const errors: ApplyResult["errors"] = [];
  let skipped = 0;

  for (const emit of spec.emit) {
    if (emit.typeMeta) types.set(emit.type, emit.typeMeta);
  }

  for (let i = 0; i < records.length; i++) {
    if (options.limit && events.length >= options.limit) break;
    const record = records[i];

    let recordTime: Date | null;
    try {
      recordTime = readTime(record, spec.timestamp, spec.timezone, options.timezone);
    } catch (error) {
      errors.push({ record: i, message: messageOf(error) });
      continue;
    }

    for (const emit of spec.emit) {
      try {
        const event = buildEvent(record, emit, spec, recordTime, options.timezone);
        if (!event) {
          skipped++;
          continue;
        }
        events.push(event);
      } catch (error) {
        // One bad column shouldn't abort a 400k-row export.
        if (errors.length < 50) errors.push({ record: i, message: messageOf(error) });
        skipped++;
      }
    }
  }

  return { events, types, recordsRead: records.length, skipped, errors };
}

function buildEvent(
  record: Record_,
  emit: EmitSpec,
  spec: MappingSpec,
  recordTime: Date | null,
  userTimezone: string,
): NormalizedEvent | null {
  if (emit.where && !matchesWhere(record, emit.where)) return null;
  if (emit.skipWhen && shouldSkip(record, emit.skipWhen)) return null;

  const startedAt = emit.timestamp
    ? readTime(record, emit.timestamp, spec.timezone, userTimezone)
    : recordTime;
  if (!startedAt) return null;

  const endedAt = emit.endTimestamp
    ? readTime(record, emit.endTimestamp, spec.timezone, userTimezone)
    : null;

  const rawValue = emit.value ? readField(record, emit.value) : undefined;
  const value = emit.value ? toNumber(rawValue) : null;
  const valueText = emit.valueText ? toText(readField(record, emit.valueText)) : null;

  // An event that carries neither a number nor a label measures nothing.
  if (value === null && valueText === null) return null;
  if (emit.value && value === null) return null;

  const explicitDuration = emit.duration ? toNumber(readField(record, emit.duration)) : null;
  const durationS =
    explicitDuration ??
    (endedAt ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000) : null);

  const meta: Record<string, unknown> = {};
  if (emit.meta) {
    for (const [key, field] of Object.entries(emit.meta)) {
      const resolved = readField(record, field);
      if (resolved !== undefined && resolved !== null && resolved !== "") meta[key] = resolved;
    }
  }

  const externalId = emit.externalId ? toText(readField(record, emit.externalId)) : null;
  const dedupeKey = externalId
    ? `${spec.key}:${emit.type}:${externalId}`
    : `${spec.key}:${emit.type}:${startedAt.toISOString()}`;

  return {
    typeKey: emit.type,
    startedAt,
    endedAt,
    durationS,
    value,
    valueText,
    localDate: localDateOf(startedAt, userTimezone),
    meta,
    dedupeKey,
  };
}

/** Does this record satisfy an emit's `where` condition? */
function matchesWhere(record: Record_, where: WhereSpec): boolean {
  const raw = getPath(record, where.path);
  if (where.equals !== undefined) {
    if (String(raw ?? "") !== String(where.equals)) return false;
  }
  if (where.in !== undefined) {
    const asText = String(raw ?? "");
    if (!where.in.some((candidate) => String(candidate) === asText)) return false;
  }
  if (where.contains !== undefined) {
    if (!String(raw ?? "").toLowerCase().includes(where.contains.toLowerCase())) return false;
  }
  return true;
}

function shouldSkip(record: Record_, skipWhen: NonNullable<EmitSpec["skipWhen"]>): boolean {
  const raw = getPath(record, skipWhen.path);
  const isEmpty = raw === undefined || raw === null || String(raw).trim() === "";
  const numeric = Number(String(raw ?? "").replace(/,/g, ""));
  const isZero = !isEmpty && Number.isFinite(numeric) && numeric === 0;

  switch (skipWhen.is) {
    case "empty":
      return isEmpty;
    case "zero":
      return isZero;
    case "emptyOrZero":
      return isEmpty || isZero;
    case "notNumeric":
      return isEmpty || !Number.isFinite(numeric);
  }
}

/** Resolve a field spec against a record and run its transforms. */
export function readField(record: Record_, field: FieldSpec): unknown {
  let value: unknown;

  if (field.const !== undefined) {
    value = field.const;
  } else if (field.coalesce) {
    for (const path of field.coalesce) {
      const candidate = getPath(record, path);
      if (candidate !== undefined && candidate !== null && candidate !== "") {
        value = candidate;
        break;
      }
    }
  } else if (field.path) {
    value = getPath(record, field.path);
  }

  for (const transform of field.transforms ?? []) {
    value = applyTransform(value, transform);
  }
  return value;
}

function applyTransform(value: unknown, transform: Transform): unknown {
  switch (transform.op) {
    case "toNumber":
      return toNumber(value);
    case "toString":
      return toText(value);
    case "trim":
      return typeof value === "string" ? value.trim() : value;
    case "lowercase":
      return typeof value === "string" ? value.toLowerCase() : value;
    case "uppercase":
      return typeof value === "string" ? value.toUpperCase() : value;
    case "multiply": {
      const n = toNumber(value);
      return n === null ? null : n * transform.by;
    }
    case "divide": {
      const n = toNumber(value);
      if (n === null || transform.by === 0) return null;
      return n / transform.by;
    }
    case "add": {
      const n = toNumber(value);
      return n === null ? null : n + transform.value;
    }
    case "round": {
      const n = toNumber(value);
      if (n === null) return null;
      const factor = 10 ** transform.decimals;
      return Math.round(n * factor) / factor;
    }
    case "clamp": {
      const n = toNumber(value);
      if (n === null) return null;
      let result = n;
      if (transform.min !== undefined) result = Math.max(transform.min, result);
      if (transform.max !== undefined) result = Math.min(transform.max, result);
      return result;
    }
    case "replace":
      return typeof value === "string" ? value.split(transform.find).join(transform.with) : value;
    case "extract": {
      if (typeof value !== "string") return value;
      // Specs come from a model; a bad pattern shouldn't take the import down.
      let match: RegExpMatchArray | null = null;
      try {
        match = value.match(new RegExp(transform.pattern));
      } catch {
        return null;
      }
      return match ? (match[transform.group] ?? null) : null;
    }
    case "map": {
      const key = toText(value);
      if (key === null) return transform.fallback ?? null;
      return key in transform.table ? transform.table[key] : (transform.fallback ?? null);
    }
    case "defaultTo":
      return value === undefined || value === null || value === "" ? transform.value : value;
  }
}

function readTime(
  record: Record_,
  field: FieldSpec & { format: "iso" | "epoch_s" | "epoch_ms" | "date" },
  specTimezone: "local" | "utc",
  userTimezone: string,
): Date | null {
  const raw = readField(record, field);
  if (raw === undefined || raw === null || raw === "") return null;

  switch (field.format) {
    case "epoch_s": {
      const n = toNumber(raw);
      return n === null ? null : validate(new Date(n * 1000));
    }
    case "epoch_ms": {
      const n = toNumber(raw);
      return n === null ? null : validate(new Date(n));
    }
    case "date": {
      // A bare calendar day. Anchor at noon so no timezone can nudge it onto
      // the neighbouring day.
      const text = toText(raw);
      if (!text) return null;
      const day = text.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return parseLoose(text, specTimezone, userTimezone);
      const [y, m, d] = day.split("-").map(Number);
      return validate(fromWallClock(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)), userTimezone));
    }
    case "iso":
      return parseLoose(toText(raw), specTimezone, userTimezone);
  }
}

function parseLoose(text: string | null, specTimezone: "local" | "utc", userTimezone: string): Date | null {
  if (!text) return null;

  const normalized = normalizeTimestamp(text);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;

  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized);
  if (hasZone || specTimezone === "utc") return parsed;

  // No zone in the text and the spec says these are wall-clock readings, so
  // re-anchor: Date parsed it as the *server's* local time, which is wrong.
  const naive = new Date(
    Date.UTC(
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate(),
      parsed.getHours(),
      parsed.getMinutes(),
      parsed.getSeconds(),
    ),
  );
  return validate(fromWallClock(naive, userTimezone));
}

/**
 * Coax the timestamp dialects found in real exports into something `Date` will
 * accept. Apple Health writes "2024-03-01 07:14:22 +0100" — a space instead of
 * the "T", and an offset with no colon — and `Date.parse` rejects both.
 */
function normalizeTimestamp(text: string): string {
  return (
    text
      .trim()
      // "2024-03-01 07:14" -> "2024-03-01T07:14"
      .replace(/^(\d{4}-\d{2}-\d{2})[ ](\d{2}:\d{2})/, "$1T$2")
      // " +0100" / "+0100" -> "+01:00"
      .replace(/\s*([+-])(\d{2}):?(\d{2})$/, "$1$2:$3")
      // " UTC" / " Z" -> "Z"
      .replace(/\s*(?:UTC|GMT|Z)$/i, "Z")
  );
}

function validate(date: Date): Date | null {
  if (Number.isNaN(date.getTime())) return null;
  // Guard against epoch-unit mistakes producing year 1970 or year 50000.
  const year = date.getUTCFullYear();
  return year >= 1990 && year <= 2100 ? date : null;
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  const cleaned = String(value).trim().replace(/,/g, "").replace(/[^\d.eE+-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value).trim();
  return text === "" ? null : text;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
