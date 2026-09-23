import { requireUser } from "@/lib/auth";
import { listSources } from "@/lib/db/queries";
import { apiAdapters } from "@/lib/adapters";
import { Badge, Card, SectionHeading } from "@/components/ui";
import {
  DisconnectButton,
  SimpleConnect,
  SyncButton,
  WeatherConnect,
} from "@/components/sources-client";
import { GitHubMark } from "@/components/oauth-buttons";

export default async function SourcesPage(props: PageProps<"/sources">) {
  const user = await requireUser();
  const rows = await listSources(user.id);
  const { error, connected } = await props.searchParams;

  const apiSources = rows.filter((row) => row.kind === "api");
  const importSources = rows.filter((row) => row.kind === "import");

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading
          title="Sources"
          description="Two kinds of adapter feed the same event store: ones that pull from a service directly, and ones fed by a data export."
        />

        {typeof error === "string" ? (
          <p className="mb-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {connected === "github" ? (
          <p className="mb-3 rounded-lg border border-positive/30 bg-positive/5 px-3 py-2 text-sm text-positive">
            GitHub connected and synced.
          </p>
        ) : null}

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
                          {source.eventCount.toLocaleString()} records imported ·{" "}
                          {source.lastSyncAt
                            ? `last synced ${source.lastSyncAt.toLocaleString()}`
                            : "never synced"}
                        </p>
                        {source.lastSyncError ? (
                          <p className="mt-1 text-xs text-danger">{source.lastSyncError}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <SyncButton sourceId={source.id} />
                        <DisconnectButton
                          sourceId={source.id}
                          label={source.label ?? adapter.label}
                          removesData={adapter.provider === "demo"}
                        />
                      </div>
                    </div>
                  ) : adapter.provider === "open-meteo" ? (
                    <WeatherConnect />
                  ) : adapter.provider === "demo" ? (
                    <SimpleConnect
                      provider="demo"
                      label="Sample data"
                      fields={[]}
                      hint="Adds a year of made-up data. Disconnect removes it again."
                    />
                  ) : adapter.provider === "github" ? (
                    <div className="space-y-3">
                      <a
                        href="/api/connect/github"
                        className="inline-flex h-10 items-center gap-2.5 rounded-lg bg-[#24292f] px-5 text-sm font-medium text-white transition-opacity hover:opacity-90"
                      >
                        <GitHubMark />
                        Connect with GitHub
                      </a>
                      <p className="text-xs text-muted">
                        You&apos;ll be sent to GitHub to approve read-only access, then straight back here.
                      </p>
                      <details className="text-xs text-muted">
                        <summary className="cursor-pointer hover:text-text">
                          Use a personal access token instead
                        </summary>
                        <div className="mt-3">
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
                            hint="Create a classic token with no scopes at github.com/settings/tokens."
                          />
                        </div>
                      </details>
                    </div>
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
                <div>
                  <p className="font-medium">{source.label}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {source.eventCount.toLocaleString()} records imported
                  </p>
                </div>
                <Badge tone="neutral">data dump</Badge>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
