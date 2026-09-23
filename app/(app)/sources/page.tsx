import { requireUser } from "@/lib/auth";
import { listSources } from "@/lib/db/queries";
import { weatherAdapter } from "@/lib/adapters/weather";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { WeatherConnect, SyncButton } from "@/components/sources-client";

export default async function SourcesPage() {
  const user = await requireUser();
  const rows = await listSources(user.id);

  const apiSources = rows.filter((row) => row.kind === "api");
  const importSources = rows.filter((row) => row.kind === "import");

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading
          title="Sources"
          description="Two kinds of adapter feed the same event store: ones that pull from a service directly, and ones fed by a data export."
        />

        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <h3 className="font-medium">{weatherAdapter.label}</h3>
              <p className="mt-1 text-sm text-muted">{weatherAdapter.description}</p>
              <p className="mt-2 text-xs text-muted">
                Produces {Object.keys(weatherAdapter.types).length} metrics:{" "}
                {Object.values(weatherAdapter.types)
                  .map((type) => type.label.toLowerCase())
                  .join(", ")}
                .
              </p>
            </div>
            <Badge tone="neutral">direct API</Badge>
          </div>

          <div className="mt-5 border-t border-border pt-5">
            <WeatherConnect />
          </div>
        </Card>
      </section>

      {apiSources.length > 0 ? (
        <section>
          <SectionHeading title="Connected" />
          <div className="space-y-2">
            {apiSources.map((source) => {
              const config = source.config as { placeName?: string; latitude?: number; longitude?: number };
              return (
                <Card key={source.id} className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{source.label}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {config.placeName ??
                        (config.latitude !== undefined
                          ? `${config.latitude.toFixed(3)}, ${config.longitude?.toFixed(3)}`
                          : source.provider)}
                      {source.lastSyncAt
                        ? ` · last synced ${source.lastSyncAt.toLocaleString()}`
                        : " · never synced"}
                    </p>
                    {source.lastSyncError ? (
                      <p className="mt-1 text-xs text-danger">{source.lastSyncError}</p>
                    ) : null}
                  </div>
                  <SyncButton sourceId={source.id} />
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      {importSources.length > 0 ? (
        <section>
          <SectionHeading
            title="From imports"
            description="Created automatically the first time a file from that service was converted."
          />
          <div className="space-y-2">
            {importSources.map((source) => (
              <Card key={source.id} className="flex items-center justify-between gap-3">
                <p className="font-medium">{source.label}</p>
                <Badge tone="neutral">data dump</Badge>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
