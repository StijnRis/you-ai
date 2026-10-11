import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * API keys the user brings (BYOK). Native: the OS keychain/keystore via
 * expo-secure-store. Web has no secure enclave, so localStorage — the key only
 * ever leaves the browser as a header to our own worker.
 *
 * Keys are deliberately NOT in the SQLite settings table: that database will
 * sync between devices one day, and secrets should not ride along.
 */

export type KeyName = "ai" | "tavily";

const storageKey = (name: KeyName) => `youai.key.${name}`;

export async function getKey(name: KeyName): Promise<string | null> {
  if (Platform.OS === "web") return globalThis.localStorage?.getItem(storageKey(name)) ?? null;
  return SecureStore.getItemAsync(storageKey(name));
}

export async function setKey(name: KeyName, value: string | null): Promise<void> {
  const trimmed = value?.trim() || null;
  if (Platform.OS === "web") {
    if (trimmed) globalThis.localStorage?.setItem(storageKey(name), trimmed);
    else globalThis.localStorage?.removeItem(storageKey(name));
    return;
  }
  if (trimmed) await SecureStore.setItemAsync(storageKey(name), trimmed);
  else await SecureStore.deleteItemAsync(storageKey(name));
}
