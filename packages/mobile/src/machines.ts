import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import type { Machine } from "../modules/kivotos-attention/src/KivotosAttentionModule";

const KEY = "kivotos.machines";

export async function loadMachines(): Promise<Machine[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Machine[]) : [];
  } catch {
    // A corrupt entry is treated as no machines; the user can add them again.
    return [];
  }
}

export async function saveMachines(machines: Machine[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(machines));
}

/**
 * Normalize what the user typed into a listener base URL.
 * `100.64.0.1` → `http://100.64.0.1:7380`; an explicit scheme or port is kept.
 * @returns the URL, or null when it cannot be one.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (trimmed === "") return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.port === "" && !/:\d+$/.test(url.host)) url.port = "7380";
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** What a machine's `/kivotos/hello` answers. */
export interface Hello {
  name: string;
  os: string;
}

/**
 * Ask a machine who it is. Also proves the phone passes its admission
 * (same tailnet user).
 */
export async function hello(url: string): Promise<Hello> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${url}/kivotos/hello`, { signal: controller.signal });
    if (res.status === 403) throw new Error("forbidden");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as Partial<Hello> & { kivotos?: string };
    if (body.kivotos === undefined) throw new Error("not-kivotos");
    return { name: String(body.name ?? url), os: String(body.os ?? "") };
  } finally {
    clearTimeout(timer);
  }
}

export const zh = getLocales()[0]?.languageCode === "zh";
