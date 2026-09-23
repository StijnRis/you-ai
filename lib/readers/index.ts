import Papa from "papaparse";
import { XMLParser } from "fast-xml-parser";
import { unzipSync, strFromU8 } from "fflate";
import type { z } from "zod";
import type { readerSchema } from "@/lib/mapping/spec";

export type ReaderSpec = z.infer<typeof readerSchema>;
export type SourceFormat = ReaderSpec["format"];
export type Record_ = Record<string, unknown>;

/** A file pulled out of an upload — a plain file, or one entry of a zip. */
export type ExtractedFile = {
  path: string;
  text: string;
  bytes: number;
};

/**
 * Real-world dumps arrive zipped (Apple Health, Google Takeout). Flatten the
 * archive into the text files worth looking at, biggest first, so detection
 * sees the substantive export rather than a README.
 */
export function extractFiles(filename: string, data: Uint8Array): ExtractedFile[] {
  if (!isZip(filename, data)) {
    return [{ path: filename, text: stripBom(strFromU8(data)), bytes: data.length }];
  }

  const entries = unzipSync(data, {
    filter: (file) => !file.name.endsWith("/") && isInterestingPath(file.name) && file.size < 80_000_000,
  });

  return Object.entries(entries)
    .map(([path, bytes]) => ({ path, text: stripBom(strFromU8(bytes)), bytes: bytes.length }))
    .filter((f) => f.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
}

/**
 * A UTF-8 BOM survives decoding as U+FEFF and would otherwise become part of
 * the first column's name — "﻿Date" never matches a spec's "Date".
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isZip(filename: string, data: Uint8Array): boolean {
  if (data.length < 4) return false;
  // "PK\x03\x04" — trust the magic bytes over the extension.
  const magic = data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
  return magic || filename.toLowerCase().endsWith(".zip");
}

const DATA_EXTENSIONS = [".csv", ".tsv", ".json", ".ndjson", ".jsonl", ".xml"];

function isInterestingPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.includes("__macosx/") || lower.split("/").pop()?.startsWith(".")) return false;
  return DATA_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Guess the format from the filename, falling back to the content itself. */
export function sniffFormat(path: string, text: string): SourceFormat {
  const lower = path.toLowerCase();
  if (lower.endsWith(".ndjson") || lower.endsWith(".jsonl")) return "ndjson";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".xml")) return "xml";
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return "csv";

  const head = text.slice(0, 4096).trimStart();
  if (head.startsWith("<")) return "xml";
  if (head.startsWith("{") || head.startsWith("[")) {
    // Several complete objects separated by newlines means NDJSON, not JSON.
    const lines = head.split("\n").filter((l) => l.trim());
    if (lines.length > 1 && lines.slice(0, 3).every((l) => l.trim().startsWith("{") && l.trim().endsWith("}"))) {
      return "ndjson";
    }
    return "json";
  }
  return "csv";
}

/** The delimiter a CSV actually uses, which is not always a comma. */
export function sniffDelimiter(text: string): string {
  // Score over several lines, not just the first: a preamble line ("Samsung
  // Health,7006011,7") has commas too, but the real table is wider and more
  // consistent, so the widest *repeated* count wins.
  const lines = headLines(text, 12);
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestScore = 0;
  for (const c of candidates) {
    const counts = lines.map((line) => line.split(c).length - 1).filter((n) => n > 0);
    if (counts.length === 0) continue;
    // The median count, so one odd line cannot pick the delimiter.
    const median = [...counts].sort((a, b) => a - b)[Math.floor(counts.length / 2)];
    const score = median * counts.length;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/**
 * How many lines sit above the header row.
 *
 * Plenty of exports prepend a title block before the table — a Samsung Health
 * CSV opens with "com.samsung.shealth.sleep,7006011,11" and only then gives the
 * column names. Such a line is recognisable by being much narrower than the
 * rows beneath it, so compare widths rather than hard-coding any one vendor.
 */
export function sniffSkipLines(text: string, delimiter: string): number {
  const lines = headLines(text, 12);
  if (lines.length < 2) return 0;

  const width = (line: string) => line.split(delimiter).length;
  // The table's own width: the most common width among the lines below the top.
  const tally = new Map<number, number>();
  for (const line of lines.slice(1)) tally.set(width(line), (tally.get(width(line)) ?? 0) + 1);
  let tableWidth = 0;
  let seen = 0;
  for (const [w, count] of tally) {
    if (count > seen) {
      tableWidth = w;
      seen = count;
    }
  }

  // Only skip lines that are clearly not part of the table. Requiring the table
  // to be at least three columns wide keeps single-column files intact.
  if (tableWidth < 3) return 0;
  let skip = 0;
  while (skip < lines.length - 1 && width(lines[skip]) < tableWidth / 2) skip++;
  return skip;
}

/** The first `count` non-blank lines, cheaply. */
function headLines(text: string, count: number): string[] {
  return text
    .slice(0, 64 * 1024)
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim() !== "")
    .slice(0, count);
}

/** Parse a file into flat records according to the reader half of a spec. */
export function readRecords(text: string, reader: ReaderSpec, limit?: number): Record_[] {
  switch (reader.format) {
    case "csv":
      return readCsv(text, reader, limit);
    case "json":
      return readJson(text, reader.recordsPath, limit);
    case "ndjson":
      return readNdjson(text, limit);
    case "xml":
      return readXml(text, reader.recordsPath, limit);
  }
}

function readCsv(text: string, reader: Extract<ReaderSpec, { format: "csv" }>, limit?: number): Record_[] {
  const stripped = stripBom(text);
  const body = reader.skipLines > 0 ? dropLines(stripped, reader.skipLines) : stripped;
  const result = Papa.parse<Record_>(body, {
    header: reader.header,
    delimiter: reader.delimiter,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
    preview: limit ?? 0,
  });
  return (result.data as Record_[])
    .filter((r) => r && typeof r === "object")
    .map(dropTrailingExtra);
}

/** Drop `count` non-blank lines from the front, preserving the rest verbatim. */
function dropLines(text: string, count: number): string {
  const lines = text.split("\n");
  let dropped = 0;
  let i = 0;
  while (i < lines.length && dropped < count) {
    if (lines[i].trim() !== "") dropped++;
    i++;
  }
  return lines.slice(i).join("\n");
}

/**
 * Many exports end every data row with the delimiter, giving each row one more
 * cell than the header. Papa parks the surplus under `__parsed_extra`, which
 * then pollutes the field list and the fingerprint. When that surplus is only
 * padding, drop it; when it holds real values the file is genuinely ragged and
 * keeping it is the honest thing to do.
 */
function dropTrailingExtra(record: Record_): Record_ {
  const extra = record.__parsed_extra;
  if (!Array.isArray(extra)) return record;
  if (extra.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== "")) {
    return record;
  }
  const rest = { ...record };
  delete rest.__parsed_extra;
  return rest;
}

function readNdjson(text: string, limit?: number): Record_[] {
  const out: Record_[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as Record_);
    } catch {
      // A truncated dump shouldn't lose the records that did parse.
    }
    if (limit && out.length >= limit) break;
  }
  return out;
}

function readJson(text: string, recordsPath: string | undefined, limit?: number): Record_[] {
  const parsed: unknown = JSON.parse(text);
  const target = recordsPath ? getPath(parsed, recordsPath) : parsed;
  const array = Array.isArray(target)
    ? target
    : // A bare object is a single record; an object of arrays is ambiguous, so
      // take the longest array inside it.
      findLongestArray(target);
  const records = array.filter((r): r is Record_ => !!r && typeof r === "object");
  return limit ? records.slice(0, limit) : records;
}

function findLongestArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  let best: unknown[] = [];
  for (const nested of Object.values(value as Record<string, unknown>)) {
    const candidate = Array.isArray(nested) ? nested : [];
    if (candidate.length > best.length) best = candidate;
  }
  return best.length ? best : [value];
}

function readXml(text: string, recordsPath: string, limit?: number): Record_[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    // Attributes are where health exports keep their data; flatten them in
    // unprefixed so a spec path reads "startDate", not "@_startDate".
    attributeNamePrefix: "",
    parseAttributeValue: false,
    parseTagValue: false,
  });
  const parsed: unknown = parser.parse(text);
  const target = getPath(parsed, recordsPath);
  const array = Array.isArray(target) ? target : target ? [target] : [];
  const records = array.filter((r): r is Record_ => !!r && typeof r === "object");
  return limit ? records.slice(0, limit) : records;
}

/** Resolve "a.b[0].c" against a parsed document. */
export function getPath(value: unknown, path: string): unknown {
  if (!path) return value;

  // A literal key wins over traversal. CSV headers are flat, and plenty of them
  // contain dots — Samsung Health names a column
  // "com.samsung.health.sleep.start_time" — which would otherwise be walked as
  // seven levels of nesting that do not exist.
  if (value && typeof value === "object" && path in (value as Record<string, unknown>)) {
    return (value as Record<string, unknown>)[path];
  }

  let current: unknown = value;
  for (const segment of path.replace(/\[(\d+)\]/g, ".$1").split(".")) {
    if (current === null || current === undefined) return undefined;
    if (!segment) continue;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** The field names present across a sample — the basis of a fingerprint. */
export function collectFields(records: Record_[], sampleSize = 50): string[] {
  const fields = new Set<string>();
  for (const record of records.slice(0, sampleSize)) {
    for (const key of Object.keys(record)) fields.add(key);
  }
  return [...fields].sort();
}
