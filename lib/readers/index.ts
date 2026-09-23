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
    return [{ path: filename, text: strFromU8(data), bytes: data.length }];
  }

  const entries = unzipSync(data, {
    filter: (file) => !file.name.endsWith("/") && isInterestingPath(file.name) && file.size < 80_000_000,
  });

  return Object.entries(entries)
    .map(([path, bytes]) => ({ path, text: strFromU8(bytes), bytes: bytes.length }))
    .filter((f) => f.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
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
  const firstLine = text.slice(0, 8192).split("\n")[0] ?? "";
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestCount = 0;
  for (const c of candidates) {
    const count = firstLine.split(c).length - 1;
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
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
  const body = reader.skipLines > 0 ? text.split("\n").slice(reader.skipLines).join("\n") : text;
  const result = Papa.parse<Record_>(body, {
    header: reader.header,
    delimiter: reader.delimiter,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
    preview: limit ?? 0,
  });
  return (result.data as Record_[]).filter((r) => r && typeof r === "object");
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
