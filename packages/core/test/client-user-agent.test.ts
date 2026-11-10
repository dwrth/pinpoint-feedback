import { describe, expect, it } from "vitest";
import {
  BrowserMetadataCollector,
  applyUserAgentData,
  collectBrowserMetadata,
  detectEnvironment,
  parseUserAgent,
} from "../src/client/index";
import { validateSubmission } from "../src/validation";

const cases: Array<[string, string, string | undefined, string, string | undefined]> = [
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Chrome", "120.0.0.0", "Windows", "10/11",
  ],
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91",
    "Edge", "120.0.2210.91", "Windows", "10/11",
  ],
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.102 Safari/537.36 Edge/18.19582",
    "Edge", "18.19582", "Windows", "10/11",
  ],
  [
    "Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0",
    "Firefox", "115.0", "Windows", "7",
  ],
  [
    "Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36 OPR/95.0.0.0",
    "Opera", "95.0.0.0", "Windows", "8.1",
  ],
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    "Safari", "17.1", "macOS", "10.15+",
  ],
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Firefox", "121.0", "macOS", "10.15+",
  ],
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.2 Safari/605.1.15",
    "Safari", "13.1.2", "macOS", "10.13.6",
  ],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1.2 Mobile/15E148 Safari/604.1",
    "Safari", "17.1.2", "iOS", "17.1.2",
  ],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
    "Chrome", "120.0.6099.119", "iOS", "17.2",
  ],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15",
    "Firefox", "120.0", "iOS", "16.6",
  ],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/119.0.2151.96 Version/17.0 Mobile/15E148 Safari/604.1",
    "Edge", "119.0.2151.96", "iOS", "17.0",
  ],
  [
    "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    "Safari", "16.6", "iPadOS", "16.6",
  ],
  [
    "Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
    "Safari", "12.1.2", "iOS", "12.5.7",
  ],
  [
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "Chrome", "120.0.0.0", "Android", "10+",
  ],
  [
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
    "Samsung Internet", "23.0", "Android", "13",
  ],
  [
    "Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0",
    "Firefox", "121.0", "Android", "14",
  ],
  [
    "Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SD1A.210817.023; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/94.0.4606.71 Mobile Safari/537.36",
    "Android WebView", "94.0.4606.71", "Android", "12",
  ],
  [
    "Mozilla/5.0 (Linux; Android 11; SM-A515F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 OPR/79.0.4195.76505",
    "Opera", "79.0.4195.76505", "Android", "11",
  ],
  [
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 EdgA/120.0.2210.84",
    "Edge", "120.0.2210.84", "Android", "10+",
  ],
  [
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Chrome", "120.0.0.0", "Linux", undefined,
  ],
  [
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Firefox", "121.0", "Linux", undefined,
  ],
  [
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Chrome", "120.0.0.0", "ChromeOS", undefined,
  ],
  [
    "Mozilla/5.0 (Windows NT 6.1; WOW64; Trident/7.0; rv:11.0) like Gecko",
    "Internet Explorer", "11.0", "Windows", "7",
  ],
  ["curl/8.4.0", "Unknown", undefined, "Unknown", undefined],
];

describe("parseUserAgent", () => {
  it.each(cases)("%s", (ua, browser, browserVersion, os, osVersion) => {
    const r = parseUserAgent(ua);
    expect(r.browser).toEqual({ name: browser, version: browserVersion });
    expect(r.os.name).toBe(os);
    expect(r.os.version).toBe(osVersion);
  });
});

describe("applyUserAgentData / detectEnvironment", () => {
  const chromeWin = cases[0]![0];

  it("resolves Windows 11 from high-entropy platformVersion", () => {
    const r = applyUserAgentData(parseUserAgent(chromeWin), {
      brands: [{ brand: "Not_A Brand", version: "8" }, { brand: "Chromium", version: "120" }, { brand: "Google Chrome", version: "120" }],
      platform: "Windows",
      platformVersion: "15.0.0",
      fullVersionList: [{ brand: "Google Chrome", version: "120.0.6099.130" }],
    });
    expect(r.browser).toEqual({ name: "Chrome", version: "120.0.6099.130" });
    expect(r.os).toEqual({ name: "Windows", version: "11" });
  });

  it("maps Windows platformVersion < 13 to 10", () => {
    const r = applyUserAgentData(parseUserAgent(chromeWin), { platform: "Windows", platformVersion: "10.0.0" });
    expect(r.os).toEqual({ name: "Windows", version: "10" });
  });

  it("prefers brands over the UA string for the browser name, keeps UA version when names match", () => {
    expect(
      applyUserAgentData(parseUserAgent(chromeWin), { brands: [{ brand: "Microsoft Edge", version: "120" }], platform: "Windows" }).browser,
    ).toEqual({ name: "Edge", version: "120" });
    expect(
      applyUserAgentData(parseUserAgent(chromeWin), { brands: [{ brand: "Google Chrome", version: "120" }], platform: "Windows" }),
    ).toEqual({ browser: { name: "Chrome", version: "120.0.0.0" }, os: { name: "Windows", version: "10/11" } });
  });

  it("detects iPadOS in desktop mode via maxTouchPoints", () => {
    const r = detectEnvironment({ userAgent: cases[5]![0], maxTouchPoints: 5 });
    expect(r.os).toEqual({ name: "iPadOS", version: "17.1" });
    expect(detectEnvironment({ userAgent: cases[5]![0], maxTouchPoints: 0 }).os.name).toBe("macOS");
  });
});

describe("BrowserMetadataCollector", () => {
  it("collects metadata that passes server validation", () => {
    const meta = collectBrowserMetadata();
    expect(meta.viewport.width).toBeGreaterThanOrEqual(0);
    expect(typeof meta.userAgent).toBe("string");
    expect(meta.url).toBe(window.location.href);
  });

  it("applies redactUrl", () => {
    const collector = new BrowserMetadataCollector({ redactUrl: () => "https://example.com/redacted" });
    expect(collector.collect().url).toBe("https://example.com/redacted");
  });

  it("truncates overlong URLs so validation still passes", () => {
    const long = `https://example.com/?q=${"a".repeat(5000)}`;
    const meta = new BrowserMetadataCollector({ redactUrl: () => long }).collect();
    expect(meta.url.length).toBe(2000);
    const v = validateSubmission({
      submissionId: "3b241101-e2bb-4255-8caf-4136c566a962",
      title: "x",
      category: "bug",
      priority: "low",
      metadata: meta,
      createdAt: new Date().toISOString(),
    });
    expect(v.ok).toBe(true);
  });
});
