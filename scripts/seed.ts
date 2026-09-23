/**
 * Seeds the built-in conversions, and optionally the admin account. Sample
 * data is no longer seeded — users connect it themselves on the Sources page.
 *
 *   pnpm db:seed             # built-in conversions only
 *   pnpm db:seed --admin     # plus the admin account from ADMIN_EMAIL/ADMIN_PASSWORD
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mappingSpecs, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/password";
import { builtinSpecs } from "@/lib/mapping/builtin";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin@youai.nl").toLowerCase();
const TZ = process.env.SEED_TIMEZONE ?? "Europe/Madrid";

async function seedConversions() {
  for (const spec of builtinSpecs) {
    await db
      .insert(mappingSpecs)
      .values({
        userId: null,
        key: spec.key,
        name: spec.name,
        provider: spec.provider,
        origin: "builtin",
        spec,
      })
      .onConflictDoUpdate({
        target: mappingSpecs.key,
        set: { spec, name: spec.name, provider: spec.provider, updatedAt: new Date() },
      });
  }
  // Fingerprints are learned, not seeded: a built-in picks them up the first
  // time it matches a real file.
  console.log(`Seeded ${builtinSpecs.length} built-in conversions.`);
}

/**
 * Create (or repair) the admin account. Safe to re-run: an existing account is
 * promoted rather than duplicated, and its password is only set if one was
 * supplied.
 */
async function seedAdmin() {
  const password = process.env.ADMIN_PASSWORD;

  const existing = await db.query.users.findFirst({ where: eq(users.email, ADMIN_EMAIL) });

  if (existing) {
    await db
      .update(users)
      .set({
        role: "admin",
        disabledAt: null,
        ...(password ? { passwordHash: await hashPassword(password) } : {}),
      })
      .where(eq(users.id, existing.id));
    console.log(
      `Promoted ${ADMIN_EMAIL} to admin${password ? " and reset its password" : ""}.`,
    );
    return existing.id;
  }

  if (!password) {
    console.log(
      `No account for ${ADMIN_EMAIL} yet. Set ADMIN_PASSWORD and re-run, or just register with that address — it becomes an admin automatically.`,
    );
    return null;
  }

  const [created] = await db
    .insert(users)
    .values({
      email: ADMIN_EMAIL,
      name: "Admin",
      role: "admin",
      timezone: TZ,
      passwordHash: await hashPassword(password),
    })
    .returning();

  console.log(`Created admin ${ADMIN_EMAIL}. Sign in with the password from ADMIN_PASSWORD.`);
  return created.id;
}

async function main() {
  await seedConversions();

  if (process.argv.includes("--admin")) await seedAdmin();
  process.exit(0);
}

void main();
