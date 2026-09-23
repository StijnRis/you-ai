import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { localDateOf } from "@/lib/events/time";
import { resendConfigured } from "@/lib/email/resend";
import { getMoodStats } from "@/lib/mood/stats";
import { recentMoodEntries } from "@/lib/mood/log";
import { moodFace } from "@/lib/mood/types";
import { Badge, Card, EmptyState, SectionHeading, Stat } from "@/components/ui";
import { MoodEmailSettings, MoodLogger } from "@/components/mood-client";

export default async function MoodPage() {
  const user = await requireUser();
  const today = localDateOf(new Date(), user.timezone);

  const [stats, recent, [row]] = await Promise.all([
    getMoodStats(user.id, today),
    recentMoodEntries(user.id, 8),
    db
      .select({ moodEmailHour: users.moodEmailHour })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1),
  ]);

  const face = stats.latest ? moodFace(stats.latest.value) : null;

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading
          title="How are you today?"
          description="One tap. Logged by hand or pulled from the mood connector, it all lands on the same series — so mood can be correlated against everything else you track."
        />
        <Card>
          <MoodLogger initial={null} />
        </Card>
      </section>

      {stats.days === 0 ? (
        <EmptyState
          title="No mood data yet"
          description="Log your first check-in above, or connect the Fake mood feed source to backfill a year of simulated history and see the stats fill in."
        />
      ) : (
        <>
          <section>
            <SectionHeading title="Where you are" />
            <Card>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                <Stat
                  label="Latest"
                  value={
                    <span className="flex items-baseline gap-2">
                      <span aria-hidden>{face!.emoji}</span>
                      {stats.latest!.value.toFixed(1)}
                    </span>
                  }
                  hint={
                    stats.latest!.localDate === today ? "today" : stats.latest!.localDate
                  }
                />
                <Stat
                  label="All-time"
                  value={stats.average!.toFixed(1)}
                  hint={`over ${stats.days} ${stats.days === 1 ? "day" : "days"}`}
                />
                <Stat
                  label="This week"
                  value={stats.trend ? stats.trend.recent.toFixed(1) : "—"}
                  hint={
                    stats.trend ? (
                      <span
                        className={
                          stats.trend.delta >= 0.15
                            ? "text-positive"
                            : stats.trend.delta <= -0.15
                              ? "text-negative"
                              : undefined
                        }
                      >
                        {stats.trend.delta >= 0 ? "+" : "−"}
                        {Math.abs(stats.trend.delta).toFixed(1)} on last week
                      </span>
                    ) : (
                      "needs a few more days"
                    )
                  }
                />
                <Stat
                  label="Streak"
                  value={stats.streak > 0 ? `${stats.streak}🔥` : "—"}
                  hint={stats.streak === 1 ? "day logged" : "days in a row"}
                />
              </div>
            </Card>
          </section>

          {stats.facts.length > 0 ? (
            <section>
              <SectionHeading
                title="Did you know?"
                description="Patterns found in your own data. Only shown when the gap is big enough to mean something."
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {stats.facts.map((fact) => (
                  <Card key={fact.headline}>
                    <p className="flex items-start gap-2 font-medium">
                      <span aria-hidden>💡</span>
                      {fact.headline}
                    </p>
                    <p className="mt-1.5 text-sm text-muted">{fact.detail}</p>
                  </Card>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <SectionHeading
              title="Your top days"
              description="Best and worst on record, by that day's average."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Card>
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-subtle">
                  🏆 Best
                </p>
                <Leaderboard days={stats.best} />
              </Card>
              <Card>
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-subtle">
                  🌧️ Toughest
                </p>
                <Leaderboard days={stats.worst} />
              </Card>
            </div>
          </section>
        </>
      )}

      {recent.length > 0 ? (
        <section>
          <SectionHeading title="Recent check-ins" />
          <div className="space-y-2">
            {recent.map((entry) => (
              <Card key={entry.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-xl" aria-hidden>
                    {moodFace(entry.value).emoji}
                  </span>
                  <div>
                    <p className="tnum font-medium">{entry.value.toFixed(1)}</p>
                    {entry.note ? (
                      <p className="text-sm text-muted">{entry.note}</p>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={entry.manual ? "accent" : "neutral"}>
                    {entry.manual ? "logged" : "synced"}
                  </Badge>
                  <p className="text-xs text-muted">
                    {entry.startedAt.toLocaleString(undefined, {
                      timeZone: user.timezone,
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <SectionHeading
          title="Daily email"
          description="A morning note with where your mood is, which way it is moving, and one or two things you might not have noticed."
        />
        <Card>
          <MoodEmailSettings
            initialHour={row?.moodEmailHour ?? null}
            timezone={user.timezone}
            configured={resendConfigured()}
          />
        </Card>
      </section>
    </div>
  );
}

function Leaderboard({ days }: { days: { localDate: string; value: number }[] }) {
  if (days.length === 0) return <p className="text-sm text-muted">Not enough data yet.</p>;

  return (
    <ol className="space-y-2">
      {days.map((day, index) => (
        <li key={day.localDate} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2.5 text-sm">
            <span className="tnum w-4 text-subtle">{index + 1}</span>
            <span aria-hidden>{moodFace(day.value).emoji}</span>
            {new Date(`${day.localDate}T12:00:00Z`).toLocaleDateString(undefined, {
              timeZone: "UTC",
              weekday: "short",
              day: "numeric",
              month: "short",
            })}
          </span>
          <span className="tnum font-medium">{day.value.toFixed(1)}</span>
        </li>
      ))}
    </ol>
  );
}
