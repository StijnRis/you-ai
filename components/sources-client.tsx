"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, RefreshCw } from "lucide-react";

/**
 * Connecting weather needs coordinates. Asking for a latitude and longitude is
 * hostile, so the browser's geolocation fills them in — but the fields stay
 * editable, because people also want the weather where they *were*.
 */
export function WeatherConnect() {
  const router = useRouter();
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [placeName, setPlaceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function locate() {
    if (!navigator.geolocation) {
      setError("This browser cannot share a location. Enter coordinates by hand.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(4));
        setLongitude(position.coords.longitude.toFixed(4));
        setError(null);
      },
      () => setError("Location permission denied. Enter coordinates by hand."),
    );
  }

  async function connect() {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "open-meteo",
          label: placeName ? `Weather — ${placeName}` : "Weather",
          config: {
            latitude: Number(latitude),
            longitude: Number(longitude),
            placeName: placeName || undefined,
          },
        }),
      });
      const payload = await response.json();

      if (payload.error) throw new Error(payload.error);
      if (payload.syncError) {
        setError(`Connected, but the first sync failed: ${payload.syncError}`);
      } else {
        setMessage(
          `Connected. Backfilled ${payload.sync?.eventsStored?.toLocaleString() ?? 0} readings across ${payload.sync?.daysTouched ?? 0} days.`,
        );
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const valid = Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && latitude !== "" && longitude !== "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Latitude" value={latitude} onChange={setLatitude} placeholder="40.4168" />
        <Field label="Longitude" value={longitude} onChange={setLongitude} placeholder="-3.7038" />
        <Field
          label="Name (optional)"
          value={placeName}
          onChange={setPlaceName}
          placeholder="Madrid"
          wide
        />

        <button
          onClick={locate}
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-colors hover:bg-surface-2"
        >
          <MapPin className="size-3.5" aria-hidden />
          Use my location
        </button>

        <button
          onClick={connect}
          disabled={!valid || busy}
          className="flex h-9 items-center gap-2 rounded-lg bg-text px-4 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          Connect
        </button>
      </div>

      {message ? <p className="text-sm text-positive">{message}</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <p className="text-xs text-muted">
        The first sync backfills a year, so there is something to correlate against immediately.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  wide,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  wide?: boolean;
}) {
  return (
    <label className="block text-xs text-muted">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`mt-1 block h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-text outline-none focus:border-border-strong ${wide ? "w-40" : "w-28"}`}
      />
    </label>
  );
}

export function SyncButton({ sourceId }: { sourceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    try {
      await fetch(`/api/sources/${sourceId}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={sync}
      disabled={busy}
      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
    >
      <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden />
      Sync now
    </button>
  );
}
