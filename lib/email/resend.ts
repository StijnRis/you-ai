import { Resend } from "resend";

/**
 * Resend, created lazily and only when configured.
 *
 * The app has to run without an API key — local development, and anyone who
 * never turns the daily email on — so nothing here throws at import time.
 */
let client: Resend | null = null;

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

function resend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set.");
  client ??= new Resend(key);
  return client;
}

/** Address the daily email comes from. Must be on a domain verified in Resend. */
export function mailFrom(): string {
  return process.env.MOOD_EMAIL_FROM ?? "YouAI <onboarding@resend.dev>";
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ id: string }> {
  const { data, error } = await resend().emails.send({
    from: mailFrom(),
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
  });

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Resend returned no message id.");
  return { id: data.id };
}
