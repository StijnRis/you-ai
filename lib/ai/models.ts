export const CHAT_MODEL_OPTIONS = [
  {
    id: "Qwen/Qwen3-235B-A22B-Instruct-2507",
    label: "Qwen3 235B",
  },
  {
    id: "Qwen/Qwen3-30B-A3B-Instruct-2507",
    label: "Qwen3 30B",
  },
  {
    id: "deepseek-ai/DeepSeek-V4-Flash-0731",
    label: "DeepSeek V4 Flash",
  },
] as const;

export type ChatModelId = (typeof CHAT_MODEL_OPTIONS)[number]["id"];

export function isChatModelId(value: unknown): value is ChatModelId {
  return CHAT_MODEL_OPTIONS.some((model) => model.id === value);
}

export function chatModelLabel(id: string): string {
  return CHAT_MODEL_OPTIONS.find((model) => model.id === id)?.label ?? id;
}
