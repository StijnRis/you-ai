import * as Crypto from "expo-crypto";

/*
 * Hermes (the React Native JS engine) has no `crypto.randomUUID`, which the
 * schema uses for primary keys. Browsers already have it; only fill the gap.
 */
const g = globalThis as unknown as { crypto?: Partial<Crypto> };
g.crypto ??= {};
g.crypto.randomUUID ??= Crypto.randomUUID as Crypto["randomUUID"];
g.crypto.getRandomValues ??= Crypto.getRandomValues as Crypto["getRandomValues"];
