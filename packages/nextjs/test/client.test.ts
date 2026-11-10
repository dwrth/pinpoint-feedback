import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";

vi.mock("@pinpoint-feedback/react", () => {
  const FeedbackProvider = () => null;
  const FeedbackWidget = () => null;
  return { FeedbackProvider, FeedbackWidget, useFeedback: () => ({}) };
});

import * as base from "@pinpoint-feedback/react";
import { DEFAULT_FEEDBACK_ENDPOINT, FeedbackProvider, FeedbackWidget, useFeedback } from "../src/index";

type Props = Record<string, unknown>;
const render = (el: ReactElement) => {
  const type = el.type as (p: Props) => ReactElement;
  return type(el.props as Props);
};

describe("@pinpoint-feedback/nextjs client entry", () => {
  it("defaults the endpoint to /api/feedback without requiring children", () => {
    const out = render(createElement(FeedbackProvider, { position: "bottom-right", theme: "light" }));
    expect(out.type).toBe(base.FeedbackProvider);
    expect(out.props).toMatchObject({ endpoint: DEFAULT_FEEDBACK_ENDPOINT, position: "bottom-right", theme: "light" });
    expect(DEFAULT_FEEDBACK_ENDPOINT).toBe("/api/feedback");
  });

  it("keeps an explicit endpoint", () => {
    const out = render(createElement(FeedbackWidget, { endpoint: "/feedback" }));
    expect(out.type).toBe(base.FeedbackWidget);
    expect((out.props as Props).endpoint).toBe("/feedback");
  });

  it("uses NEXT_PUBLIC_* defaults when set", () => {
    vi.stubEnv("NEXT_PUBLIC_PINPOINT_ENDPOINT", "/custom/feedback");
    vi.stubEnv("NEXT_PUBLIC_PINPOINT_PROJECT_ID", "site-a");
    try {
      const out = render(createElement(FeedbackProvider, {}));
      expect(out.props).toMatchObject({ endpoint: "/custom/feedback", projectId: "site-a" });
      const explicit = render(createElement(FeedbackProvider, { projectId: "site-b" }));
      expect((explicit.props as Props).projectId).toBe("site-b");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("passes categories and defaultCategory through", () => {
    const categories = [{ id: "perf", label: "Performance", color: "orange" }, "bug"] as const;
    const out = render(createElement(FeedbackProvider<typeof categories>, { categories, defaultCategory: "perf" }));
    expect(out.props).toMatchObject({ categories, defaultCategory: "perf", endpoint: DEFAULT_FEEDBACK_ENDPOINT });
  });

  it("re-exports the React API", () => {
    expect(useFeedback).toBe(base.useFeedback);
  });
});
