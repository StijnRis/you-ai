import { useCallback, useEffect, useState, type DependencyList } from "react";
import { useDataVersion } from "./data-events";

/**
 * Run an async local query; re-run it when its deps change or when data
 * changes anywhere in the app. Enough for an app whose "server" is SQLite.
 */
export function useQuery<T>(load: () => Promise<T>, deps: DependencyList = []) {
  const version = useDataVersion();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `load` is recreated every render; the explicit deps are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
