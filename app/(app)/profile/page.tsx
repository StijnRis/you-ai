import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { accounts, users } from "@/lib/db/schema";
import { getDataRange, getMetricOverview } from "@/lib/db/queries";
import { Badge, Card, SectionHeading, Stat } from "@/components/ui";
import { ProfileForms } from "@/components/profile-forms";
import { formatDate } from "@/lib/utils";

export default async function ProfilePage() {
  const session = await requireUser();

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      timezone: users.timezone,
      latitude: users.latitude,
      longitude: users.longitude,
      createdAt: users.createdAt,
      hasPassword: users.passwordHash,
    })
    .from(users)
    .where(eq(users.id, session.id))
    .limit(1);

  const linked = await db
    .select({ provider: accounts.provider })
    .from(accounts)
    .where(eq(accounts.userId, session.id));

  const [metrics, range] = await Promise.all([
    getMetricOverview(session.id),
    getDataRange(session.id),
  ]);

  const totalEvents = metrics.reduce((sum, metric) => sum + metric.days, 0);

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading
          title="Profile"
          description="Your account, and everything it owns."
          action={
            user.role === "admin" ? <Badge tone="accent">admin</Badge> : null
          }
        />

        <Card>
          <div className="grid gap-6 sm:grid-cols-4">
            <Stat label="Email" value={<span className="text-base">{user.email}</span>} />
            <Stat label="Metrics" value={metrics.length} />
            <Stat
              label="Days tracked"
              value={range?.days ?? 0}
              hint={range ? `${formatDate(range.from)} – ${formatDate(range.to)}` : "nothing yet"}
            />
            <Stat label="Member since" value={<span className="text-base">{user.createdAt.toLocaleDateString()}</span>} />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-xs text-muted">
            <span>Sign-in methods:</span>
            {user.hasPassword ? <Badge tone="neutral">password</Badge> : null}
            {linked.map((row) => (
              <Badge key={row.provider} tone="neutral">
                {row.provider}
              </Badge>
            ))}
            {!user.hasPassword && linked.length === 0 ? <span>none — set a password below</span> : null}
          </div>
        </Card>
      </section>

      <ProfileForms
        name={user.name ?? ""}
        email={user.email ?? ""}
        timezone={user.timezone}
        latitude={user.latitude}
        longitude={user.longitude}
        hasPassword={Boolean(user.hasPassword)}
        dataSummary={{ metrics: metrics.length, days: range?.days ?? 0, series: totalEvents }}
      />
    </div>
  );
}
