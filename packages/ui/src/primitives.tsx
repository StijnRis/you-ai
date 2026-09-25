import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { cn } from "./cn";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <View className={cn("rounded-xl border border-border bg-surface p-4", className)}>{children}</View>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <View className="mb-4 flex-row items-end justify-between gap-4">
      <View className="flex-1">
        <Text className="text-lg font-semibold tracking-tight text-text">{title}</Text>
        {description ? <Text className="mt-1 text-sm text-muted">{description}</Text> : null}
      </View>
      {action}
    </View>
  );
}

const BADGE_TONES = {
  neutral: { box: "bg-surface-2 border-border", text: "text-muted" },
  accent: { box: "bg-accent-soft border-transparent", text: "text-accent" },
  positive: { box: "bg-surface-2 border-transparent", text: "text-positive" },
  negative: { box: "bg-surface-2 border-transparent", text: "text-negative" },
  danger: { box: "bg-surface-2 border-transparent", text: "text-danger" },
} as const;

export type Tone = keyof typeof BADGE_TONES;

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  const t = BADGE_TONES[tone];
  return (
    <View className={cn("self-start rounded-md border px-1.5 py-0.5", t.box)}>
      <Text className={cn("text-xs font-medium", t.text)}>{children}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <View className="items-center rounded-xl border border-dashed border-border-strong px-6 py-12">
      <Text className="font-medium text-text">{title}</Text>
      <Text className="mt-1.5 max-w-md text-center text-sm text-muted">{description}</Text>
      {action ? <View className="mt-5">{action}</View> : null}
    </View>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <View>
      <Text className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</Text>
      <Text className="mt-1 text-2xl font-semibold tracking-tight text-text">{value}</Text>
      {hint ? <Text className="mt-0.5 text-xs text-muted">{hint}</Text> : null}
    </View>
  );
}

export function Button({
  children,
  onPress,
  variant = "primary",
  disabled,
  busy,
  className,
}: {
  children: ReactNode;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  const box = {
    primary: "bg-text",
    secondary: "border border-border bg-surface",
    danger: "border border-border bg-surface",
    ghost: "",
  }[variant];
  const text = {
    primary: "text-bg",
    secondary: "text-text",
    danger: "text-danger",
    ghost: "text-accent",
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      className={cn(
        "flex-row items-center justify-center gap-2 rounded-lg px-4 py-2.5 active:opacity-80",
        box,
        (disabled || busy) && "opacity-50",
        className,
      )}
    >
      {busy ? <ActivityIndicator size="small" /> : null}
      <Text className={cn("text-sm font-medium", text)}>{children}</Text>
    </Pressable>
  );
}

export function Field({ label, help, ...props }: TextInputProps & { label: string; help?: string }) {
  return (
    <View className="gap-1">
      <Text className="text-sm font-medium text-text">{label}</Text>
      <TextInput
        placeholderTextColor="#a8a29e"
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        {...props}
      />
      {help ? <Text className="text-xs text-muted">{help}</Text> : null}
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text className="text-sm text-danger">{children}</Text>;
}

export function Loading() {
  return (
    <View className="items-center py-12">
      <ActivityIndicator />
    </View>
  );
}
