import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { streamChat } from "@youai/core/chat/chat";
import { getSetting } from "@youai/core/settings";

/**
 * `useChat` normally POSTs to a server route. Here the "server" is this device:
 * the transport runs the model loop locally, so tools query SQLite directly and
 * only the model request itself goes out (through the worker).
 */
export class LocalChatTransport implements ChatTransport<UIMessage> {
  async sendMessages({
    messages,
    abortSignal,
    body,
  }: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]): Promise<ReadableStream<UIMessageChunk>> {
    const model = (body as { model?: string } | undefined)?.model ?? (await getSetting("chatModel"));
    return streamChat({
      messages,
      model,
      timezone: await getSetting("timezone"),
      abortSignal,
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    // Nothing persists between app sessions to reconnect to.
    return null;
  }
}
