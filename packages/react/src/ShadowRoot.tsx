import { PINPOINT_IGNORE_ATTRIBUTE } from "@pinpoint-feedback/core";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import css from "./styles.css?inline";

let shadowCss: string | undefined;

/**
 * `@property` rules are ignored inside shadow roots, so Tailwind utilities relying on
 * registered initial values (border-style, shadows, rings, transforms…) would break.
 * Re-declare every registered initial value as a plain custom property instead.
 */
export function withPropertyFallbacks(source: string): string {
  const declarations: string[] = [];
  const re = /@property\s+(--[\w-]+)\s*\{([^}]*)\}/g;
  for (let match = re.exec(source); match; match = re.exec(source)) {
    const initial = /initial-value\s*:\s*([^;]+?)\s*(?:;|$)/.exec(match[2] ?? "");
    if (initial) declarations.push(`${match[1]}:${initial[1]}`);
  }
  if (!declarations.length) return source;
  return `${source}\n@layer base{:host,*,::before,::after,::backdrop{${declarations.join(";")}}}`;
}

function getShadowCss(): string {
  shadowCss ??= withPropertyFallbacks(css);
  return shadowCss;
}

export interface ShadowPortalProps {
  children: ReactNode;
  zIndex: number;
  theme: "light" | "dark";
  accentColor?: string;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? () => {} : useLayoutEffect;

/** Renders children into an isolated shadow root attached to a host element on document.body. */
export function ShadowPortal({ children, zIndex, theme, accentColor }: ShadowPortalProps) {
  const [mount, setMount] = useState<{ host: HTMLElement; container: HTMLElement } | null>(null);

  useIsomorphicLayoutEffect(() => {
    const host = document.createElement("div");
    host.setAttribute(PINPOINT_IGNORE_ATTRIBUTE, "");
    host.setAttribute("data-pinpoint-feedback", "");
    host.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = getShadowCss();
    const container = document.createElement("div");
    container.className = "pp-root";
    shadow.append(style, container);
    document.body.appendChild(host);
    setMount({ host, container });
    return () => {
      host.remove();
      setMount(null);
    };
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!mount) return;
    mount.host.style.zIndex = String(zIndex);
    mount.container.setAttribute("data-theme", theme);
    if (accentColor) mount.container.style.setProperty("--pp-accent", accentColor);
    else mount.container.style.removeProperty("--pp-accent");
  }, [mount, zIndex, theme, accentColor]);

  if (!mount) return null;
  return createPortal(children, mount.container);
}

