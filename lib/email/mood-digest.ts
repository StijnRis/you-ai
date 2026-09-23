import { WEEKDAY_NAMES, weekdayOf } from "@/lib/events/time";
import type { MoodStats } from "@/lib/mood/stats";
import { moodFace } from "@/lib/mood/types";

export type MoodDigest = { subject: string; html: string; text: string };

/**
 * The daily email: where your mood is now, which way it is moving, and one or
 * two things you would not have noticed yourself.
 *
 * Inline styles and a table-free layout, because that is what survives the
 * mail clients; the plain-text part carries the same content for the rest.
 */
export function renderMoodDigest(params: {
  stats: MoodStats;
  today: string;
  appUrl: string;
}): MoodDigest {
  const { stats, today, appUrl } = params;
  const face = stats.latest ? moodFace(stats.latest.value) : null;
  const weekday = WEEKDAY_NAMES[weekdayOf(today)];

  const subject = stats.latest
    ? `${face!.emoji} Your mood is ${stats.latest.value.toFixed(1)}/10`
    : "How are you feeling today?";

  const lines: string[] = [];
  const blocks: string[] = [];

  if (stats.latest) {
    const stale = stats.latest.localDate !== today;
    lines.push(
      `${face!.emoji}  ${stats.latest.value.toFixed(1)}/10 — ${face!.label}${stale ? ` (last logged ${stats.latest.localDate})` : ""}`,
    );
    blocks.push(`
      <div style="text-align:center;padding:28px 20px;background:#f6f6f7;border-radius:12px">
        <div style="font-size:52px;line-height:1">${face!.emoji}</div>
        <div style="font-size:34px;font-weight:600;margin-top:10px;color:#111">${stats.latest.value.toFixed(1)}<span style="font-size:18px;color:#71717a">/10</span></div>
        <div style="font-size:15px;color:#52525b;margin-top:4px">${face!.label}</div>
        ${stale ? `<div style="font-size:12px;color:#a1a1aa;margin-top:8px">Last logged ${escapeHtml(stats.latest.localDate)}</div>` : ""}
      </div>`);
  } else {
    lines.push("No mood logged yet — open YouAI and log your first one.");
    blocks.push(
      `<p style="font-size:15px;color:#52525b">No mood logged yet. Open YouAI and log your first one.</p>`,
    );
  }

  const summary: string[] = [];
  if (stats.trend) {
    const { delta } = stats.trend;
    const word = delta >= 0.15 ? "up" : delta <= -0.15 ? "down" : "steady";
    summary.push(
      word === "steady"
        ? "Steady against last week"
        : `${word === "up" ? "Up" : "Down"} ${Math.abs(delta).toFixed(1)} on last week`,
    );
  }
  if (stats.streak > 1) summary.push(`${stats.streak}-day streak`);
  if (stats.average !== null) summary.push(`${stats.average.toFixed(1)} all-time average`);

  if (summary.length > 0) {
    lines.push("", summary.join(" · "));
    blocks.push(
      `<p style="font-size:14px;color:#52525b;text-align:center;margin:18px 0 0">${summary.map(escapeHtml).join(" &middot; ")}</p>`,
    );
  }

  if (stats.facts.length > 0) {
    lines.push("", "Did you know?");
    const cards = stats.facts.slice(0, 2);
    for (const fact of cards) lines.push(`• ${fact.headline} — ${fact.detail}`);

    blocks.push(`
      <p style="font-size:13px;font-weight:600;color:#71717a;text-transform:uppercase;letter-spacing:.04em;margin:30px 0 10px">Did you know?</p>
      ${cards
        .map(
          (fact) => `
        <div style="border:1px solid #e4e4e7;border-radius:10px;padding:14px 16px;margin-bottom:10px">
          <div style="font-size:15px;font-weight:600;color:#111">${escapeHtml(fact.headline)}</div>
          <div style="font-size:14px;color:#52525b;margin-top:4px">${escapeHtml(fact.detail)}</div>
        </div>`,
        )
        .join("")}`);
  }

  const moodUrl = `${appUrl.replace(/\/$/, "")}/mood`;
  lines.push("", `Log today's mood: ${moodUrl}`);

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto">
    <p style="font-size:13px;color:#a1a1aa;margin:0 0 18px">${escapeHtml(weekday)} &middot; YouAI</p>
    ${blocks.join("\n")}
    <p style="margin:30px 0 0;text-align:center">
      <a href="${escapeHtml(moodUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:11px 22px;border-radius:9px">Log today&rsquo;s mood</a>
    </p>
    <p style="font-size:12px;color:#a1a1aa;text-align:center;margin:22px 0 0">
      Change the time or turn this off on your <a href="${escapeHtml(moodUrl)}" style="color:#71717a">Mood page</a>.
    </p>
  </div>
</body></html>`;

  return { subject, html, text: lines.join("\n") };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
