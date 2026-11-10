import type { NameVersion } from "../types";

export interface ParsedUserAgent {
  browser: NameVersion;
  os: NameVersion;
}

export interface UserAgentBrand {
  brand: string;
  version: string;
}

/** Subset of `NavigatorUAData` (User-Agent Client Hints), including optional high-entropy values. */
export interface UserAgentDataLike {
  brands?: readonly UserAgentBrand[];
  fullVersionList?: readonly UserAgentBrand[];
  mobile?: boolean;
  platform?: string;
  platformVersion?: string;
}

export interface EnvironmentHints {
  userAgent: string;
  userAgentData?: UserAgentDataLike;
  /** `navigator.maxTouchPoints`; used to tell iPadOS (which sends a macOS UA) from macOS. */
  maxTouchPoints?: number;
}

const BROWSER_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\/([\d.]+)/, "Edge"],
  [/\bSamsungBrowser\/([\d.]+)/, "Samsung Internet"],
  [/\b(?:OPR|OPT|OPiOS)\/([\d.]+)/, "Opera"],
  [/\bOpera\b.*\bVersion\/([\d.]+)/, "Opera"],
  [/\bVivaldi\/([\d.]+)/, "Vivaldi"],
  [/\bYaBrowser\/([\d.]+)/, "Yandex"],
  [/\bCriOS\/([\d.]+)/, "Chrome"],
  [/\bFxiOS\/([\d.]+)/, "Firefox"],
  [/\bFirefox\/([\d.]+)/, "Firefox"],
  [/; wv\).*\bChrome\/([\d.]+)/, "Android WebView"],
  [/\bChromium\/([\d.]+)/, "Chromium"],
  [/\bChrome\/([\d.]+)/, "Chrome"],
  [/\bVersion\/([\d.]+).*\bSafari\//, "Safari"],
  [/\bMSIE ([\d.]+)/, "Internet Explorer"],
  [/\bTrident\/.*\brv:([\d.]+)/, "Internet Explorer"],
];

const WINDOWS_NT_VERSIONS: Readonly<Record<string, string>> = {
  // Windows 11 still reports "NT 10.0"; only client hints can tell them apart.
  "10.0": "10/11",
  "6.3": "8.1",
  "6.2": "8",
  "6.1": "7",
  "6.0": "Vista",
  "5.2": "XP",
  "5.1": "XP",
};

const dotted = (v: string) => v.replace(/_/g, ".");

export function parseBrowser(ua: string): NameVersion {
  for (const [re, name] of BROWSER_RULES) {
    const m = re.exec(ua);
    if (m) return { name, version: m[1] };
  }
  return { name: "Unknown" };
}

export function parseOs(ua: string): NameVersion {
  let m: RegExpExecArray | null;
  if ((m = /\bWindows NT ([\d.]+)/.exec(ua))) {
    return { name: "Windows", version: WINDOWS_NT_VERSIONS[m[1] ?? ""] ?? m[1] };
  }
  if (/\bWindows\b/.test(ua)) return { name: "Windows" };
  if (/\bCrOS\b/.test(ua)) return { name: "ChromeOS" };
  if ((m = /\biPad\b.*?\bOS ([\d_]+)/.exec(ua))) {
    const version = dotted(m[1] ?? "");
    return { name: Number.parseInt(version, 10) >= 13 ? "iPadOS" : "iOS", version };
  }
  if ((m = /\b(?:iPhone|iPod)\b.*?\bOS ([\d_]+)/.exec(ua))) return { name: "iOS", version: dotted(m[1] ?? "") };
  if (/\b(?:iPhone|iPad|iPod)\b/.test(ua)) return { name: "iOS" };
  if ((m = /\bAndroid(?:[ /]([\d.]+))?/.exec(ua))) {
    // Chrome's reduced UA freezes the Android version at 10 with device model "K".
    if (m[1] === "10" && /\bAndroid 10; K\)/.test(ua)) return { name: "Android", version: "10+" };
    return m[1] ? { name: "Android", version: m[1] } : { name: "Android" };
  }
  if ((m = /\bMac OS X ([\d_.]+)/.exec(ua))) {
    const version = dotted(m[1] ?? "");
    // Safari, Chrome and Firefox all freeze the reported macOS version at 10.15(.7).
    return { name: "macOS", version: /^10\.15(\.7)?$/.test(version) ? "10.15+" : version };
  }
  if (/\bMacintosh\b/.test(ua)) return { name: "macOS" };
  if (/\b(?:Linux|X11)\b/.test(ua)) return { name: "Linux" };
  return { name: "Unknown" };
}

/** Dependency-free browser/OS detection from a User-Agent string. */
export function parseUserAgent(ua: string): ParsedUserAgent {
  return { browser: parseBrowser(ua), os: parseOs(ua) };
}

const BRAND_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Microsoft Edge$/i, "Edge"],
  [/^Opera( GX)?$/i, "Opera"],
  [/^Samsung Internet$/i, "Samsung Internet"],
  [/^Vivaldi$/i, "Vivaldi"],
  [/^Brave$/i, "Brave"],
  [/^YaBrowser$/i, "Yandex"],
  [/^Google Chrome$/i, "Chrome"],
];

const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android: "Android",
  "chrome os": "ChromeOS",
  "chromium os": "ChromeOS",
  chromeos: "ChromeOS",
  ios: "iOS",
};

function findBrand(list: readonly UserAgentBrand[] | undefined): { name: string; version: string } | undefined {
  for (const [re, name] of BRAND_NAMES) {
    const hit = list?.find((b) => re.test(b.brand));
    if (hit) return { name, version: hit.version };
  }
  return undefined;
}

function platformVersion(name: string, raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (name !== "Windows") return raw;
  const major = Number.parseInt(raw, 10);
  if (!Number.isFinite(major)) return undefined;
  if (major >= 13) return "11";
  if (major > 0) return "10";
  return undefined;
}

/**
 * Refines a UA-string parse with User-Agent Client Hints. The UA string usually carries the more
 * precise version, so it is kept when both agree on the name.
 */
export function applyUserAgentData(base: ParsedUserAgent, data: UserAgentDataLike | undefined): ParsedUserAgent {
  if (!data) return base;
  let browser = base.browser;
  const full = findBrand(data.fullVersionList);
  const major = findBrand(data.brands);
  if (full) browser = { name: full.name, version: full.version || undefined };
  else if (major && major.name !== base.browser.name) browser = { name: major.name, version: major.version || undefined };

  let os = base.os;
  const platform = data.platform ? PLATFORM_NAMES[data.platform.trim().toLowerCase()] : undefined;
  if (platform) {
    const version = platformVersion(platform, data.platformVersion);
    if (version) os = { name: platform, version };
    else if (platform === base.os.name) os = base.os;
    else os = { name: platform };
  }
  return { browser, os };
}

/** Full detection: UA string, then Client Hints, then the iPadOS-desktop-mode heuristic. */
export function detectEnvironment(hints: EnvironmentHints): ParsedUserAgent {
  const result = applyUserAgentData(parseUserAgent(hints.userAgent), hints.userAgentData);
  if (result.os.name === "macOS" && (hints.maxTouchPoints ?? 0) > 1 && !hints.userAgentData?.platform) {
    // iPadOS Safari reports a macOS UA; Safari's own version tracks the OS version there.
    const safari = result.browser.name === "Safari" ? result.browser.version : undefined;
    return { browser: result.browser, os: safari ? { name: "iPadOS", version: safari } : { name: "iPadOS" } };
  }
  return result;
}
