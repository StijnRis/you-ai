"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight, ArrowUp, ExternalLink, FlaskConical, Loader2, Square, Wrench } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CHAT_MODEL_OPTIONS, chatModelLabel, isChatModelId, type ChatModelId } from "@/lib/ai/models";

type MetricInfo = { key: string; label: string; days: number };
type HumanRatings = { first?: number; second?: number };
type ChatEvaluation = {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
};

function isChatEvaluation(value: unknown): value is ChatEvaluation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ChatEvaluation>;
  return (
    typeof item.model === "string" &&
    typeof item.durationMs === "number" &&
    (item.totalTokens === null || typeof item.totalTokens === "number")
  );
}

function evaluationFromMetadata(metadata: unknown): ChatEvaluation | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as { chatEvaluation?: unknown }).chatEvaluation;
  return isChatEvaluation(value) ? value : null;
}

/** Openers that only make sense once there is data, phrased as a person would. */
function suggestionsFor(metrics: MetricInfo[]): string[] {
  const names = metrics.slice(0, 3).map((metric) => metric.label.toLowerCase());
  const suggestions = ["What patterns are hiding in my data?"];
  if (names[0]) suggestions.push(`How has my ${names[0]} changed over the last month?`);
  if (names[0] && names[1]) suggestions.push(`Does ${names[1]} affect my ${names[0]}?`);
  suggestions.push("Are my weekends different from my weekdays?");
  suggestions.push("I want to exercise more — design an experiment for me");
  return suggestions;
}

export function ChatPanel({
  metrics,
  initialInput = "",
  suggestions,
  emptyHint,
}: {
  metrics: MetricInfo[];
  initialInput?: string;
  /** Overrides the generic openers — the Experiments page seeds its own. */
  suggestions?: string[];
  emptyHint?: string;
}) {
  const router = useRouter();
  const [input, setInput] = useState(initialInput);
  const [model, setModel] = useState<ChatModelId>(CHAT_MODEL_OPTIONS[0].id);
  const [humanRatings, setHumanRatings] = useState<Record<string, HumanRatings>>({});
  const [hiddenRecordIds, setHiddenRecordIds] = useState<Set<string>>(new Set());
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    [],
  );
  const { messages, sendMessage, status, stop, error } = useChat({ transport });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    try {
      localStorage.setItem("youai:chat-model", model);
      localStorage.setItem("youai:chat-ratings", JSON.stringify(humanRatings));
    } catch {
      // Local storage is optional; chat still works without it.
    }
  }, [model, humanRatings]);

  const evaluations = messages.filter(
    (message) =>
      message.role === "assistant" &&
      !hiddenRecordIds.has(message.id) &&
      evaluationFromMetadata(message.metadata),
  );

  /*
   * The model can create an experiment mid-conversation. When it does, the
   * server-rendered page around this panel — the experiment list, the count on
   * the Experiments tab — is now stale, so refresh it once per new experiment.
   */
  const announced = useRef(new Set<string>());
  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool-create_experiment") continue;
        if (!("state" in part) || part.state !== "output-available") continue;
        if (!isCreatedExperiment(part.output)) continue;
        if (announced.current.has(part.output.url)) continue;
        announced.current.add(part.output.url);
        router.refresh();
      }
    }
  }, [messages, router]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed }, { body: { model } });
    setInput("");
  }

  function resetRecords() {
    setHiddenRecordIds(new Set(evaluations.map((message) => message.id)));
    setHumanRatings({});
    try {
      localStorage.removeItem("youai:chat-ratings");
    } catch {
      // Local storage is optional; chat still works without it.
    }
  }

  function exportRecords() {
    const rows = evaluations.flatMap((message, index) => {
      const evaluation = evaluationFromMetadata(message.metadata);
      if (!evaluation) return [];
      return [[
        index + 1,
        evaluation.model,
        evaluation.inputTokens ?? "",
        evaluation.outputTokens ?? "",
        evaluation.totalTokens ?? "",
        evaluation.durationMs,
        humanRatings[message.id]?.first ?? "",
        humanRatings[message.id]?.second ?? "",
      ]];
    });
    const csv = [
      [
        "Response",
        "Model",
        "Input tokens",
        "Output tokens",
        "Total tokens",
        "Execution time (ms)",
        "Person 1 rating",
        "Person 2 rating",
      ],
      ...rows,
    ]
      .map((row) => row.map((value) => csvCell(value)).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `youai-chat-record-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Nebius model</span>
          <select
            value={model}
            onChange={(event) => {
              const nextModel = event.target.value;
              if (!isChatModelId(nextModel)) return;
              setModel(nextModel);
              try {
                localStorage.setItem("youai:chat-model", nextModel);
              } catch {
                // Local storage is optional; chat still works without it.
              }
            }}
            disabled={busy}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-border-strong disabled:opacity-60"
          >
            {CHAT_MODEL_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-subtle">Switch model before sending the next message</span>
      </div>

      <Card className="min-h-[24rem] space-y-6 p-6">
        {messages.length === 0 ? (
          <div className="py-8">
            <p className="text-sm text-muted">
              {metrics.length === 0
                ? "There is no data to ask about yet — import a file or connect a source first."
                : (emptyHint ?? `Tracking ${metrics.length} metrics. Try one of these:`)}
            </p>
            {metrics.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {(suggestions ?? suggestionsFor(metrics)).map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => submit(suggestion)}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {messages.map((message) => (
          <div key={message.id} className="rise">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-subtle">
              {message.role === "user" ? "You" : "YouAI"}
            </p>
            <div className="space-y-2">
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  if (message.role === "user") {
                    return (
                      <p key={index} className="whitespace-pre-wrap text-sm leading-relaxed">
                        {part.text}
                      </p>
                    );
                  }
                  return (
                    <div key={index} className="markdown text-sm leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                    </div>
                  );
                }
                // Surface which tools ran: it is the difference between an
                // answer grounded in the data and one that sounds like it is.
                if (part.type.startsWith("tool-")) {
                  const name = part.type.replace(/^tool-/, "");
                  const output =
                    "state" in part && part.state === "output-available" ? part.output : undefined;
                  return <ToolResult key={index} name={name} output={output} />;
                }
                return null;
              })}
            </div>
          </div>
        ))}

        {busy ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Working through your data…
          </p>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            {error.message}
          </p>
        ) : null}
      </Card>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(input);
            }
          }}
          rows={1}
          placeholder="Ask about your data…"
          className="min-h-11 flex-1 resize-none rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-border-strong"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop generating"
            className="flex size-11 items-center justify-center rounded-xl border border-border transition-colors hover:bg-surface-2"
          >
            <Square className="size-4" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => submit(input)}
            disabled={!input.trim()}
            aria-label="Send"
            className="flex size-11 items-center justify-center rounded-xl bg-text text-bg transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
        )}
      </form>

      {evaluations.length > 0 ? (
        <Card className="overflow-x-auto p-4">
          <div className="mb-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Chat record</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportRecords}
                  className="rounded border border-border px-2 py-1 text-xs text-muted transition-colors hover:bg-surface hover:text-text"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={resetRecords}
                  className="rounded border border-border px-2 py-1 text-xs text-muted transition-colors hover:bg-surface hover:text-text"
                >
                  Reset records
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted">
              Tokens and execution time are recorded automatically. Both people rate each answer from 1 to 5.
            </p>
          </div>
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="border-b border-border text-muted">
              <tr>
                <th className="px-2 py-2 font-medium">Model</th>
                <th className="px-2 py-2 font-medium">Tokens</th>
                <th className="px-2 py-2 font-medium">Execution time</th>
                <th className="px-2 py-2 font-medium">Person 1</th>
                <th className="px-2 py-2 font-medium">Person 2</th>
              </tr>
            </thead>
            <tbody>
              {evaluations.map((message, index) => {
                const evaluation = evaluationFromMetadata(message.metadata);
                if (!evaluation) return null;
                return (
                  <tr key={message.id} className="border-b border-border last:border-0">
                    <td className="px-2 py-2 font-medium" title={evaluation.model}>
                      {chatModelLabel(evaluation.model)}
                    </td>
                    <td className="px-2 py-2 tnum">{evaluation.totalTokens ?? "—"}</td>
                    <td className="px-2 py-2 tnum">{formatDuration(evaluation.durationMs)}</td>
                    <td className="px-2 py-2">
                      <label className="sr-only" htmlFor={`rating-${message.id}`}>
                        Person 1 rating for response {index + 1}
                      </label>
                      <select
                        id={`rating-${message.id}`}
                        value={humanRatings[message.id]?.first ?? ""}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setHumanRatings((current) => ({
                            ...current,
                            [message.id]: { ...current[message.id], first: value },
                          }));
                        }}
                        className="rounded border border-border bg-surface px-2 py-1"
                      >
                        <option value="">Rate</option>
                        {[1, 2, 3, 4, 5].map((value) => (
                          <option key={value} value={value}>
                            {value}/5
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <label className="sr-only" htmlFor={`rating-2-${message.id}`}>
                        Person 2 rating for response {index + 1}
                      </label>
                      <select
                        id={`rating-2-${message.id}`}
                        value={humanRatings[message.id]?.second ?? ""}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setHumanRatings((current) => ({
                            ...current,
                            [message.id]: { ...current[message.id], second: value },
                          }));
                        }}
                        className="rounded border border-border bg-surface px-2 py-1"
                      >
                        <option value="">Rate</option>
                        {[1, 2, 3, 4, 5].map((value) => (
                          <option key={value} value={value}>
                            {value}/5
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Most tools only need a chip. The two whose results the person will want to
 * act on — a new experiment, and the pages the research came from — get a
 * little more.
 */
function ToolResult({ name, output }: { name: string; output: unknown }) {
  if (name === "create_experiment" && isCreatedExperiment(output)) {
    return (
      <Link
        href={output.url}
        className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2.5 text-sm transition-opacity hover:opacity-90"
      >
        <FlaskConical className="size-4 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{output.title}</span>
          <span className="block text-xs text-muted">
            {output.startDate} – {output.endDate} · measuring {output.targetMetrics.join(", ")}
          </span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-accent" aria-hidden />
      </Link>
    );
  }

  if (name === "search_web" && isSearchResult(output) && output.results.length > 0) {
    return (
      <details className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-muted">
        <summary className="cursor-pointer font-mono">
          search_web · {output.results.length} sources
        </summary>
        <ul className="mt-1.5 space-y-1">
          {output.results.map((result) => (
            <li key={result.url}>
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-text hover:underline"
              >
                {result.title}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </details>
    );
  }

  return <ToolChip name={name} />;
}

function isCreatedExperiment(
  value: unknown,
): value is { url: string; title: string; startDate: string; endDate: string; targetMetrics: string[] } {
  return typeof value === "object" && value !== null && "url" in value && "targetMetrics" in value;
}

function isSearchResult(value: unknown): value is { results: { title: string; url: string }[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { results?: unknown }).results);
}

function ToolChip({ name }: { name: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2",
        "px-2 py-0.5 font-mono text-xs text-muted",
      )}
    >
      <Wrench className="size-3" aria-hidden />
      {name}
    </span>
  );
}
