import { requireUser } from "@/lib/auth";
import { getMetricOverview } from "@/lib/db/queries";
import { SectionHeading } from "@/components/ui";
import { ChatPanel } from "@/components/chat-panel";

export default async function ChatPage() {
  const user = await requireUser();
  const metrics = await getMetricOverview(user.id);

  return (
    <>
      <SectionHeading
        title="Chat"
        description="Ask about your data. The model queries the event store with real tools rather than guessing."
      />
      <ChatPanel
        metrics={metrics.map((metric) => ({ key: metric.key, label: metric.label, days: metric.days }))}
      />
    </>
  );
}
