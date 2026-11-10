import { createFeedbackClient, type FeedbackClient } from "@pinpoint-feedback/core";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { FeedbackWidgetTheme } from "./types";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function useResolvedTheme(theme: FeedbackWidgetTheme): "light" | "dark" {
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(DARK_QUERY);
    const update = () => setSystemDark(mql.matches);
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, [theme]);
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}

const clients = new Map<string, FeedbackClient>();

export function getDefaultClient(endpoint: string, maxFileBytes?: number): FeedbackClient {
  const key = `${maxFileBytes ?? ""} ${endpoint}`;
  let client = clients.get(key);
  if (!client) {
    client = createFeedbackClient({ endpoint, maxFileBytes });
    clients.set(key, client);
  }
  return client;
}

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function matchesHotkey(event: KeyboardEvent, hotkey: string): boolean {
  const parts = hotkey.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return false;
  const mods = new Set(parts);
  const apple = isApplePlatform();
  const wantMeta = mods.has("meta") || mods.has("cmd") || (mods.has("mod") && apple);
  const wantCtrl = mods.has("ctrl") || mods.has("control") || (mods.has("mod") && !apple);
  if (event.metaKey !== wantMeta || event.ctrlKey !== wantCtrl) return false;
  if (event.shiftKey !== mods.has("shift")) return false;
  if (event.altKey !== (mods.has("alt") || mods.has("option"))) return false;
  const pressed = event.key.toLowerCase();
  if (pressed === key) return true;
  return event.code.toLowerCase() === (key.length === 1 && /[a-z]/.test(key) ? `key${key}` : key);
}

export function formatHotkey(hotkey: string): string {
  const apple = isApplePlatform();
  return hotkey
    .split("+")
    .map((p) => {
      const k = p.trim().toLowerCase();
      if (k === "mod") return apple ? "⌘" : "Ctrl";
      if (k === "meta" || k === "cmd") return "⌘";
      if (k === "shift") return apple ? "⇧" : "Shift";
      if (k === "alt" || k === "option") return apple ? "⌥" : "Alt";
      if (k === "ctrl" || k === "control") return apple ? "⌃" : "Ctrl";
      return k.toUpperCase();
    })
    .join(apple ? "" : "+");
}

export function useHotkey(hotkey: string | false | undefined, handler: () => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!hotkey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !matchesHotkey(event, hotkey)) return;
      event.preventDefault();
      handlerRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hotkey]);
}

export function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const raf =
      typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 16);
    const step = (left: number) => (left <= 0 ? resolve() : raf(() => step(left - 1)));
    step(count);
  });
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[inert]") && el.getAttribute("aria-hidden") !== "true",
  );
}

export function activeElementIn(node: Node): Element | null {
  const root = node.getRootNode() as Document | ShadowRoot;
  return root.activeElement ?? null;
}

/** Keeps Tab / Shift+Tab focus cycling within `ref`. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = getFocusable(el);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = activeElementIn(el);
      if (event.shiftKey && (current === first || !el.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !el.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [ref, active]);
}
