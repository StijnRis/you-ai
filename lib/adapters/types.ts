import type { NormalizedEvent } from "@/lib/mapping/apply";
import type { TypeMeta } from "@/lib/mapping/spec";

/**
 * The second kind of adapter: one that talks to a service directly instead of
 * waiting for an export.
 *
 * Both kinds land in the same place. A dump import runs a MappingSpec to get
 * NormalizedEvents; an API adapter builds them in TypeScript. Everything
 * downstream — dedupe, rollup, correlation, chat — sees no difference.
 */
export interface ApiAdapter<Config = Record<string, unknown>> {
  /** Stable id, stored on `sources.provider`. */
  provider: string;
  label: string;
  description: string;
  /** Can be connected more than once per user, e.g. several calendars. */
  multiple?: boolean;
  /** Event types this adapter can produce, registered on first sync. */
  types: Record<string, TypeMeta>;
  /** Reject a bad config before a source row is created. */
  validateConfig(config: unknown): Config;
  /**
   * Fetch a window of data. Called with the range the caller wants; adapters
   * may return less (rate limits, provider history caps) but never more.
   */
  fetch(params: {
    config: Config;
    from: string;
    to: string;
    timezone: string;
  }): Promise<NormalizedEvent[] | { events: NormalizedEvent[]; label?: string }>;
}

export type AnyApiAdapter = ApiAdapter<never>;
