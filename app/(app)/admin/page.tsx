import { requireAdmin } from "@/lib/auth";
import { getInstanceStats, listAccounts } from "@/lib/actions/admin";
import { getSettings } from "@/lib/settings";
import { Card, SectionHeading, Stat } from "@/components/ui";
import { AccountsTable, SettingsForm } from "@/components/admin-panel";

export default async function AdminPage() {
  const admin = await requireAdmin();
  const [accounts, stats, settings] = await Promise.all([
    listAccounts(),
    getInstanceStats(),
    getSettings(),
  ]);

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading
          title="Admin"
          description="Everything on this instance. Actions here affect other people's data, so each one asks before it does anything irreversible."
        />
        <Card>
          <div className="grid gap-6 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Accounts" value={stats.accounts} hint={`${stats.admins} admin`} />
            <Stat label="Disabled" value={stats.disabled} />
            <Stat label="Events" value={stats.events.toLocaleString()} />
            <Stat label="Metric days" value={stats.metricDays.toLocaleString()} />
            <Stat label="Imports" value={stats.imports} />
            <Stat label="Sources" value={stats.sources} />
          </div>
        </Card>
      </section>

      <section>
        <SectionHeading
          title="Accounts"
          description="Disabling blocks sign-in but keeps the data. Deleting does not."
        />
        <AccountsTable accounts={accounts} currentAdminId={admin.id} />
      </section>

      <section>
        <SectionHeading
          title="Settings"
          description="Applied immediately, for everyone, without a redeploy."
        />
        <SettingsForm settings={settings} />
      </section>
    </div>
  );
}
