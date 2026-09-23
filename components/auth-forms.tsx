"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle, Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/actions/account";

export function Field({
  label,
  name,
  type = "text",
  required = true,
  defaultValue,
  placeholder,
  autoComplete,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number | null;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue ?? undefined}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="mt-1.5 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-border-strong"
      />
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p
        role="status"
        className="rounded-lg border border-positive/30 bg-positive/5 px-3 py-2 text-sm text-positive"
      >
        {state.success}
      </p>
    );
  }
  return null;
}

export function SubmitButton({
  children,
  pending,
  variant = "primary",
}: {
  children: React.ReactNode;
  pending: boolean;
  variant?: "primary" | "danger" | "ghost";
}) {
  const styles = {
    primary: "bg-text text-bg hover:opacity-90",
    danger: "bg-danger text-white hover:opacity-90",
    ghost: "border border-border hover:bg-surface-2",
  };
  return (
    <button
      type="submit"
      disabled={pending}
      className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50 ${styles[variant]}`}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */

export function SignInForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />
      <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com" />
      <Field label="Password" name="password" type="password" autoComplete="current-password" />
      <SubmitButton pending={pending}>Sign in</SubmitButton>
      <p className="text-sm text-muted">
        No account?{" "}
        <Link href="/register" className="font-medium text-accent hover:underline">
          Create one
        </Link>
        .
      </p>
    </form>
  );
}

export function RegisterForm({
  action,
  defaultTimezone,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  defaultTimezone: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />
      <Field label="Name" name="name" autoComplete="name" placeholder="Alex" />
      <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com" />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters. Length beats punctuation."
      />
      <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" />
      {/* Guessed from the browser, so nobody has to think about it on sign-up. */}
      <TimezoneField fallback={defaultTimezone} />
      <SubmitButton pending={pending}>Create account</SubmitButton>
      <p className="text-sm text-muted">
        Already have one?{" "}
        <Link href="/signin" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
        .
      </p>
    </form>
  );
}

function TimezoneField({ fallback }: { fallback: string }) {
  const guessed =
    typeof Intl !== "undefined"
      ? (Intl.DateTimeFormat().resolvedOptions().timeZone ?? fallback)
      : fallback;
  return <input type="hidden" name="timezone" value={guessed} />;
}
