import type { MetadataCollector } from "../interfaces";
import { LIMITS } from "../limits";
import type { BrowserMetadata } from "../types";
import { detectEnvironment, type UserAgentDataLike } from "./user-agent";

export interface BrowserMetadataCollectorOptions {
  /** Rewrites page/referrer URLs before they are sent (e.g. to strip tokens from query strings). */
  redactUrl?: (url: string) => string;
}

type UaDataNavigator = Navigator & {
  userAgentData?: UserAgentDataLike & {
    getHighEntropyValues?: (hints: string[]) => Promise<UserAgentDataLike>;
  };
};

const truncate = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

export class BrowserMetadataCollector implements MetadataCollector {
  private highEntropy?: UserAgentDataLike;

  constructor(private readonly options: BrowserMetadataCollectorOptions = {}) {}

  /**
   * Fetches high-entropy Client Hints (full browser version, real OS version — e.g. to tell
   * Windows 11 from 10) so later `collect()` calls can use them. Optional; never rejects.
   */
  async prime(): Promise<void> {
    if (typeof navigator === "undefined") return;
    const data = (navigator as UaDataNavigator).userAgentData;
    if (!data?.getHighEntropyValues) return;
    try {
      this.highEntropy = await data.getHighEntropyValues(["platformVersion", "fullVersionList"]);
    } catch {
      this.highEntropy = undefined;
    }
  }

  collect(): BrowserMetadata {
    const hasWindow = typeof window !== "undefined";
    const hasDocument = typeof document !== "undefined";
    const nav = typeof navigator !== "undefined" ? (navigator as UaDataNavigator) : undefined;
    const userAgent = nav?.userAgent ?? "";

    const uaData = nav?.userAgentData;
    const userAgentData: UserAgentDataLike | undefined = uaData
      ? {
          brands: uaData.brands,
          mobile: uaData.mobile,
          platform: uaData.platform,
          ...this.highEntropy,
        }
      : undefined;
    const { browser, os } = detectEnvironment({ userAgent, userAgentData, maxTouchPoints: nav?.maxTouchPoints });

    const redact = (url: string) => truncate(this.options.redactUrl ? this.options.redactUrl(url) : url, LIMITS.urlMax);
    const referrer = hasDocument && document.referrer ? redact(document.referrer) : undefined;

    let timezone: string | undefined;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch {
      timezone = undefined;
    }

    return {
      url: hasWindow ? redact(window.location.href) : "",
      pageTitle: hasDocument ? truncate(document.title, 500) : "",
      referrer,
      userAgent: truncate(userAgent, 1000),
      browser,
      os,
      viewport: hasWindow
        ? { width: window.innerWidth, height: window.innerHeight }
        : { width: 0, height: 0 },
      screen: hasWindow && window.screen
        ? { width: window.screen.width, height: window.screen.height }
        : { width: 0, height: 0 },
      devicePixelRatio: hasWindow && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1,
      language: nav?.language || undefined,
      timezone,
    };
  }
}

export function collectBrowserMetadata(options?: BrowserMetadataCollectorOptions): BrowserMetadata {
  return new BrowserMetadataCollector(options).collect();
}
