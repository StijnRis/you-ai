"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight, ArrowUp, ExternalLink, FlaskConical, Loader2, Square, Wrench } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

type MetricInfo = { key: string; label: string; days: number };

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
}: {
  metrics: MetricInfo[];
  initialInput?: string;
}) {
  const [input, setInput] = useState(initialInput);
  const { messages, sendMessage, status, stop, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const busy = status === "submitted" || status === "streaming";

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <div className="space-y-4">
      <Card className="min-h-[24rem] space-y-6 p-6">
        {messages.length === 0 ? (
          <div className="py-8">
            <p className="text-sm text-muted">
              {metrics.length === 0
                ? "There is no data to ask about yet — import a file or connect a source first."
                : `Tracking ${metrics.length} metrics. Try one of these:`}
            </p>
            {metrics.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {suggestionsFor(metrics).map((suggestion) => (
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
    </div>
  );
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
