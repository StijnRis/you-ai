import { requireUser } from "@/lib/auth";
import { listSources } from "@/lib/db/queries";
import { apiAdapters } from "@/lib/adapters";
import { Badge, Card, SectionHeading } from "@/components/ui";
import { SimpleConnect, SyncButton, WeatherConnect } from "@/components/sources-client";

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

        <div className="space-y-3">
          {Object.values(apiAdapters).map((adapter) => {
            const source = apiSources.find((row) => row.provider === adapter.provider);
            return (
              <Card key={adapter.provider}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-xl">
                    <h3 className="font-medium">{source?.label ?? adapter.label}</h3>
                    <p className="mt-1 text-sm text-muted">{adapter.description}</p>
                    <p className="mt-2 text-xs text-muted">
                      Produces{" "}
                      {Object.values(adapter.types)
                        .map((type) => type.label.toLowerCase())
                        .join(", ")}
                      .
                    </p>
                  </div>
                  <Badge tone={source ? "positive" : "neutral"}>
                    {source ? "connected" : "direct API"}
                  </Badge>
                </div>

                <div className="mt-5 border-t border-border pt-5">
                  {source ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs text-muted">
                          {source.lastSyncAt
                            ? `Last synced ${source.lastSyncAt.toLocaleString()}`
                            : "Never synced"}
                        </p>
                        {source.lastSyncError ? (
                          <p className="mt-1 text-xs text-danger">{source.lastSyncError}</p>
                        ) : null}
                      </div>
                      <SyncButton sourceId={source.id} />
                    </div>
                  ) : adapter.provider === "open-meteo" ? (
                    <WeatherConnect />
                  ) : adapter.provider === "github" ? (
                    <SimpleConnect
                      provider="github"
                      label="GitHub"
                      fields={[
                        { key: "username", label: "Username", placeholder: "octocat" },
                        {
                          key: "token",
                          label: "Token",
                          placeholder: "ghp_…",
                          secret: true,
                          optional: true,
                        },
                      ]}
                      hint="GitHub's API needs a token even for public activity. Create a classic token with no scopes at github.com/settings/tokens."
                    />
                  ) : (
                    <SimpleConnect
                      provider="google-calendar"
                      label="Google Calendar"
                      fields={[
                        {
                          key: "icalUrl",
                          label: "Secret iCal address",
                          placeholder: "https://calendar.google.com/calendar/ical/…/basic.ics",
                          secret: true,
                          wide: true,
                        },
                      ]}
                      hint="In Google Calendar: Settings → your calendar → Integrate calendar → Secret address in iCal format."
                    />
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </section>

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
