import { useLocalSearchParams } from "expo-router";
import { getMetricOverview } from "@youai/core/db/queries";
import { Loading, SectionHeading } from "@youai/ui";
import { ChatPanel } from "../../components/chat-panel";
import { Screen } from "../../components/screen";
import { KeyNotice } from "../../components/key-notice";
import { useQuery } from "../../lib/use-query";

export default function ChatScreen() {
  // Other screens link here with a question already written, e.g. "how did my experiment go?"
  const { q } = useLocalSearchParams<{ q?: string }>();
  const { data: metrics } = useQuery(getMetricOverview);

  return (
    <Screen tab refresh={false}>
      <SectionHeading
        title="Chat"
        description="Ask about your data. The model queries your on-device store with real tools rather than guessing."
      />
      <KeyNotice />
      {metrics ? (
        <ChatPanel
          key={q ?? ""}
          metrics={metrics.map((m) => ({ key: m.key, label: m.label, days: m.days }))}
          initialInput={typeof q === "string" ? q : ""}
        />
      ) : (
        <Loading />
      )}
    </Screen>
  );
}
