import { useEffect, useState } from "react";

/**
 * A tiny "the data changed" signal. Screens re-run their queries when an
 * import, sync or edit finishes, without a global store.
 */
const listeners = new Set<() => void>();

export function notifyDataChanged(): void {
  for (const listener of listeners) listener();
}

export function useDataVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return version;
}
