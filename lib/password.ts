import bcrypt from "bcryptjs";
import { z } from "zod";

/**
 * Password handling.
 *
 * Email verification is deliberately off, so signing up is one step. That makes
 * the password the only thing standing behind an account, which is why the
 * policy below is a length floor rather than a character-class puzzle: length
 * is what actually resists guessing, and composition rules mostly produce
 * "Password1!".
 */

const COST = 12;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email("that does not look like an email address");

export const passwordSchema = z
  .string()
  .min(10, "use at least 10 characters")
  .max(200, "that is longer than 200 characters");

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    /*
     * The account exists but has no password — it was created through Google or
     * GitHub. Still run a hash so the response takes the same time as a wrong
     * password would, otherwise the timing difference tells an attacker which
     * emails are registered and how.
     */
    await bcrypt.hash(password, COST);
    return false;
  }
  return bcrypt.compare(password, hash);
}

/** Burn the same time as a real check, for an email that does not exist. */
export async function fakeVerify(): Promise<void> {
  await bcrypt.hash("timing-equalisation", COST);
}
