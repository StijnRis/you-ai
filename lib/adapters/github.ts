import { z } from "zod";
import type { ApiAdapter } from "@/lib/adapters/types";
import type { NormalizedEvent } from "@/lib/mapping/apply";
import type { TypeMeta } from "@/lib/mapping/spec";
import { localDateOf, noonOn, shiftLocalDate } from "@/lib/events/time";

/**
 * GitHub activity via the GraphQL API: the contribution calendar (the green
 * squares) plus commits per day. GraphQL needs a token even for public data;
 * a classic token with no scopes is enough for public activity.
 */

const configSchema = z.object({
  username: z.string().min(1),
  /** Falls back to GITHUB_TOKEN from the environment. */
  token: z.string().optional(),
});

export type GitHubConfig = z.infer<typeof configSchema>;

const TYPES: Record<string, TypeMeta> = {
  "github.contributions": {
    label: "GitHub contributions",
    unit: "contributions",
    valueKind: "numeric",
    aggregation: "sum",
    polarity: 0,
    category: "productivity",
    correlatable: true,
    description: "Commits, PRs, issues and reviews — the squares on your GitHub profile.",
  },
  "github.commits": {
    label: "GitHub commits",
    unit: "commits",
    valueKind: "numeric",
    aggregation: "sum",
    polarity: 0,
    category: "productivity",
    correlatable: true,
  },
};

const QUERY = `
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
      commitContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner }
        contributions(first: 100) { nodes { occurredAt commitCount } }
      }
    }
  }
}`;

type Payload = {
  errors?: { message: string }[];
  data?: {
    user: {
      contributionsCollection: {
        contributionCalendar: { weeks: { contributionDays: { date: string; contributionCount: number }[] }[] };
        commitContributionsByRepository: {
          repository: { nameWithOwner: string };
          contributions: { nodes: { occurredAt: string; commitCount: number }[] };
        }[];
      };
    } | null;
  };
};

export const githubAdapter: ApiAdapter<GitHubConfig> = {
  provider: "github",
  label: "GitHub",
  description: "Daily contributions and commits from your GitHub profile.",
  types: TYPES,

  validateConfig(config: unknown): GitHubConfig {
    return configSchema.parse(config);
  },

  async fetch({ config, from, to, timezone }): Promise<NormalizedEvent[]> {
    const token = config.token || process.env.GITHUB_TOKEN;
    if (!token) throw new Error("A GitHub token is required (or set GITHUB_TOKEN).");

    // GitHub caps a contributions query at one year.
    const earliest = shiftLocalDate(to, -364);
    const start = from < earliest ? earliest : from;

    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        query: QUERY,
        variables: { login: config.username, from: `${start}T00:00:00Z`, to: `${to}T23:59:59Z` },
      }),
    });
    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    const payload = (await response.json()) as Payload;
    if (payload.errors?.length) throw new Error(`GitHub: ${payload.errors[0].message}`);
    const collection = payload.data?.user?.contributionsCollection;
    if (!collection) throw new Error(`GitHub user "${config.username}" not found.`);

    const events: NormalizedEvent[] = [];
    for (const week of collection.contributionCalendar.weeks) {
      for (const day of week.contributionDays) {
        events.push({
          typeKey: "github.contributions",
          startedAt: noonOn(day.date, timezone),
          endedAt: null,
          durationS: null,
          value: day.contributionCount,
          valueText: null,
          localDate: day.date,
          meta: {},
          dedupeKey: `github:${config.username}:contributions:${day.date}`,
        });
      }
    }

    for (const repo of collection.commitContributionsByRepository) {
      for (const node of repo.contributions.nodes) {
        const startedAt = new Date(node.occurredAt);
        events.push({
          typeKey: "github.commits",
          startedAt,
          endedAt: null,
          durationS: null,
          value: node.commitCount,
          valueText: repo.repository.nameWithOwner,
          localDate: localDateOf(startedAt, timezone),
          meta: { repository: repo.repository.nameWithOwner },
          dedupeKey: `github:${config.username}:commits:${repo.repository.nameWithOwner}:${node.occurredAt}`,
        });
      }
    }
    return events;
  },
};
