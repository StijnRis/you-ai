import { requireUser } from "@/lib/auth";
import { getMetricOverview } from "@/lib/db/queries";
import { SectionHeading } from "@/components/ui";
import { ChatPanel } from "@/components/chat-panel";

export default async function ChatPage(props: PageProps<"/chat">) {
  const user = await requireUser();
  const metrics = await getMetricOverview(user.id);
  // Other pages link here with a question already written, e.g. "how did my
  // experiment go?" — it lands in the input rather than being sent unseen.
  const { q } = await props.searchParams;

  return (
    <>
      <SectionHeading
        title="Chat"
        description="Ask about your data. The model queries the event store with real tools rather than guessing."
      />
      <ChatPanel
        metrics={metrics.map((metric) => ({ key: metric.key, label: metric.label, days: metric.days }))}
        initialInput={typeof q === "string" ? q : ""}
      />
    </>
  );
}
