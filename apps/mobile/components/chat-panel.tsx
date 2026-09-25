import { useMemo, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Share, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useChat } from "@ai-sdk/react";
import Markdown from "react-native-markdown-display";
import { CHAT_MODEL_OPTIONS, chatModelLabel, type ChatModelId } from "@youai/core/ai/models";
import { Card, cn } from "@youai/ui";
import { LocalChatTransport } from "../lib/chat-transport";
import { notifyDataChanged } from "../lib/data-events";

type MetricInfo = { key: string; label: string; days: number };
type HumanRatings = { first?: number; second?: number };
type ChatEvaluation = {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
};

function evaluationFromMetadata(metadata: unknown): ChatEvaluation | null {
  const value = (metadata as { chatEvaluation?: Partial<ChatEvaluation> } | undefined)?.chatEvaluation;
  return value && typeof value.model === "string" && typeof value.durationMs === "number"
    ? (value as ChatEvaluation)
    : null;
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
  /** A question another screen pre-wrote; lands in the input rather than being sent unseen. */
  initialInput?: string;
  /** Overrides the generic openers — the Experiments screen seeds its own. */
  suggestions?: string[];
  emptyHint?: string;
}) {
  const [input, setInput] = useState(initialInput);
  const [model, setModel] = useState<ChatModelId>(CHAT_MODEL_OPTIONS[0].id);
  const [ratings, setRatings] = useState<Record<string, HumanRatings>>({});
  const [hiddenRecordIds, setHiddenRecordIds] = useState<Set<string>>(new Set());
  const transport = useMemo(() => new LocalChatTransport(), []);
  const { messages, sendMessage, status, stop, error } = useChat({
    transport,
    // The model may have created an experiment; let other screens re-query.
    onFinish: () => notifyDataChanged(),
  });

  const busy = status === "submitted" || status === "streaming";
  const evaluations = messages.filter(
    (m) => m.role === "assistant" && !hiddenRecordIds.has(m.id) && evaluationFromMetadata(m.metadata),
  );

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    void sendMessage({ text: trimmed }, { body: { model } });
    setInput("");
  }

  async function exportRecords() {
    const rows = evaluations.flatMap((message, index) => {
      const e = evaluationFromMetadata(message.metadata);
      if (!e) return [];
      return [[index + 1, e.model, e.inputTokens ?? "", e.outputTokens ?? "", e.totalTokens ?? "", e.durationMs, ratings[message.id]?.first ?? "", ratings[message.id]?.second ?? ""]];
    });
    const csv = [
      ["Response", "Model", "Input tokens", "Output tokens", "Total tokens", "Execution time (ms)", "Person 1 rating", "Person 2 rating"],
      ...rows,
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");

    if (Platform.OS === "web") {
      const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `youai-chat-record-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } else {
      await Share.share({ message: csv, title: "YouAI chat record" });
    }
  }

  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
        <Text className="text-sm text-muted">Model</Text>
        {CHAT_MODEL_OPTIONS.map((option) => (
          <Pressable
            key={option.id}
            disabled={busy}
            onPress={() => setModel(option.id)}
            className={cn("rounded-md border px-2 py-1", model === option.id ? "border-accent bg-accent-soft" : "border-border bg-surface")}
          >
            <Text className={cn("text-xs", model === option.id ? "text-accent" : "text-muted")}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      <Card className="min-h-[300px] gap-6">
        {messages.length === 0 ? (
          <View className="py-6">
            <Text className="text-sm text-muted">
              {metrics.length === 0
                ? "There is no data to ask about yet — import a file or connect a source first."
                : (emptyHint ?? `Tracking ${metrics.length} metrics. Try one of these:`)}
            </Text>
            {metrics.length > 0 ? (
              <View className="mt-4 flex-row flex-wrap gap-2">
                {(suggestions ?? suggestionsFor(metrics)).map((suggestion) => (
                  <Pressable key={suggestion} onPress={() => submit(suggestion)} className="rounded-lg border border-border px-3 py-1.5">
                    <Text className="text-sm text-muted">{suggestion}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {messages.map((message) => (
          <View key={message.id}>
            <Text className="mb-1.5 text-xs font-medium uppercase tracking-wide text-subtle">
              {message.role === "user" ? "You" : "YouAI"}
            </Text>
            <View className="gap-2">
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  return message.role === "user" ? (
                    <Text key={index} className="text-sm leading-relaxed text-text">
                      {part.text}
                    </Text>
                  ) : (
                    <MarkdownText key={index} text={part.text} />
                  );
                }
                // Surface which tools ran: it is the difference between an
                // answer grounded in the data and one that sounds like it is.
                if (part.type.startsWith("tool-")) {
                  const output = "state" in part && part.state === "output-available" ? part.output : undefined;
                  return <ToolResult key={index} name={part.type.replace(/^tool-/, "")} output={output} />;
                }
                return null;
              })}
            </View>
          </View>
        ))}

        {busy ? (
          <View className="flex-row items-center gap-2">
            <ActivityIndicator size="small" />
            <Text className="text-sm text-muted">Working through your data…</Text>
          </View>
        ) : null}
        {error ? (
          <Text className="rounded-lg border border-danger px-3 py-2 text-sm text-danger">{error.message}</Text>
        ) : null}
      </Card>

      <View className="flex-row items-end gap-2">
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => submit(input)}
          placeholder="Ask about your data…"
          placeholderTextColor="#a8a29e"
          multiline
          blurOnSubmit
          className="min-h-11 flex-1 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-text"
        />
        <Pressable
          accessibilityLabel={busy ? "Stop generating" : "Send"}
          onPress={busy ? stop : () => submit(input)}
          disabled={!busy && !input.trim()}
          className={cn("size-11 items-center justify-center rounded-xl", busy ? "border border-border" : "bg-text", !busy && !input.trim() && "opacity-30")}
        >
          <Ionicons name={busy ? "stop" : "arrow-up"} size={18} color={busy ? "#78716c" : "#fbfbfa"} />
        </Pressable>
      </View>

      {evaluations.length > 0 ? (
        <Card className="gap-3">
          <View className="flex-row items-center justify-between gap-3">
            <Text className="text-sm font-medium text-text">Chat record</Text>
            <View className="flex-row gap-2">
              <SmallButton label="Export CSV" onPress={exportRecords} />
              <SmallButton
                label="Reset records"
                onPress={() => {
                  setHiddenRecordIds(new Set(evaluations.map((m) => m.id)));
                  setRatings({});
                }}
              />
            </View>
          </View>
          <Text className="text-xs text-muted">
            Tokens and execution time are recorded automatically. Both people rate each answer from 1 to 5.
          </Text>
          {evaluations.map((message) => {
            const e = evaluationFromMetadata(message.metadata)!;
            return (
              <View key={message.id} className="gap-1 border-t border-border pt-2">
                <Text className="text-xs text-text">
                  <Text className="font-medium">{chatModelLabel(e.model)}</Text> · {e.totalTokens ?? "—"} tokens ·{" "}
                  {e.durationMs < 1000 ? `${e.durationMs} ms` : `${(e.durationMs / 1000).toFixed(1)} s`}
                </Text>
                {(["first", "second"] as const).map((person, i) => (
                  <View key={person} className="flex-row items-center gap-1">
                    <Text className="w-16 text-xs text-muted">Person {i + 1}</Text>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <Pressable
                        key={value}
                        onPress={() => setRatings((c) => ({ ...c, [message.id]: { ...c[message.id], [person]: value } }))}
                        className={cn("size-7 items-center justify-center rounded border", ratings[message.id]?.[person] === value ? "border-accent bg-accent-soft" : "border-border")}
                      >
                        <Text className="text-xs text-text">{value}</Text>
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
            );
          })}
        </Card>
      ) : null}
    </View>
  );
}

function SmallButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="rounded border border-border px-2 py-1">
      <Text className="text-xs text-muted">{label}</Text>
    </Pressable>
  );
}

function MarkdownText({ text }: { text: string }) {
  return (
    <Markdown
      style={{
        body: { fontSize: 14, lineHeight: 21, color: "#78716c" },
        strong: { fontWeight: "600" },
        link: { color: "#4338ca" },
        code_inline: { backgroundColor: "transparent", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
      }}
      onLinkPress={(url) => {
        void Linking.openURL(url);
        return false;
      }}
    >
      {text}
    </Markdown>
  );
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Most tools only need a chip. The two whose results the person will want to
 * act on — a new experiment, and the pages the research came from — get more.
 */
function ToolResult({ name, output }: { name: string; output: unknown }) {
  const [open, setOpen] = useState(false);

  if (name === "create_experiment" && isCreatedExperiment(output)) {
    return (
      <Link href={output.url as never} asChild>
        <Pressable className="flex-row items-center gap-3 rounded-lg border border-accent bg-accent-soft px-3 py-2.5">
          <Ionicons name="flask-outline" size={16} color="#4338ca" />
          <View className="flex-1">
            <Text className="text-sm font-medium text-text">{output.title}</Text>
            <Text className="text-xs text-muted">
              {output.startDate} – {output.endDate} · measuring {output.targetMetrics.join(", ")}
            </Text>
          </View>
          <Ionicons name="arrow-forward" size={16} color="#4338ca" />
        </Pressable>
      </Link>
    );
  }

  if (name === "search_web" && isSearchResult(output) && output.results.length > 0) {
    return (
      <View className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5">
        <Pressable onPress={() => setOpen(!open)}>
          <Text className="font-mono text-xs text-muted">
            {open ? "▾" : "▸"} search_web · {output.results.length} sources
          </Text>
        </Pressable>
        {open
          ? output.results.map((result) => (
              <Pressable key={result.url} onPress={() => void Linking.openURL(result.url)}>
                <Text className="mt-1 text-xs text-accent">{result.title}</Text>
              </Pressable>
            ))
          : null}
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-1.5 self-start rounded-md border border-border bg-surface-2 px-2 py-0.5">
      <Ionicons name="construct-outline" size={12} color="#78716c" />
      <Text className="font-mono text-xs text-muted">{name}</Text>
    </View>
  );
}

function isCreatedExperiment(
  value: unknown,
): value is { url: string; title: string; startDate: string; endDate: string; targetMetrics: string[] } {
  return typeof value === "object" && value !== null && "url" in value && "targetMetrics" in value;
}

function isSearchResult(value: unknown): value is { results: { title: string; url: string }[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { results?: unknown }).results);
}
