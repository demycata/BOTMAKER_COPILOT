// Wrapper minimo y tipado sobre chrome.storage.local.
// Para datos grandes (base de conocimiento, embeddings) mas adelante usaremos
// IndexedDB; chrome.storage.local queda para configuracion liviana.

import type { AutomationRule, Shortcut } from '@/types';

interface StorageShape {
  rules: AutomationRule[];
  rulesEnabled: boolean;
  shortcuts: Shortcut[];
  postponeGreeting: string;
  closeMessage: string;
}

const DEFAULTS: StorageShape = {
  rules: [],
  rulesEnabled: false,
  shortcuts: [],
  postponeGreeting: '',
  closeMessage: '',
};

export async function get<K extends keyof StorageShape>(
  key: K,
): Promise<StorageShape[K]> {
  const res = await chrome.storage.local.get(key);
  return (res[key] ?? DEFAULTS[key]) as StorageShape[K];
}

export async function set<K extends keyof StorageShape>(
  key: K,
  value: StorageShape[K],
): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}
