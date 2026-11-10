import { describe, expect, it } from "vitest";
import { FallbackOutbox, IndexedDbOutbox, MemoryOutbox, createOutbox } from "../src/client/index";
import type { OutboxEntry } from "../src/interfaces";
import { makeSubmission } from "./client-helpers";

const entry = (createdAt: string, attempts = 0): OutboxEntry => ({
  submission: makeSubmission({ createdAt }),
  files: { screenshot: new Blob(["x"], { type: "image/png" }) },
  attempts,
});

describe("MemoryOutbox", () => {
  it("put/get/list/remove", async () => {
    const box = new MemoryOutbox();
    const a = entry("2026-01-02T00:00:00.000Z");
    const b = entry("2026-01-01T00:00:00.000Z");
    await box.put(a);
    await box.put(b);
    expect((await box.get(a.submission.submissionId))?.submission.title).toBe(a.submission.title);
    expect((await box.list()).map((e) => e.submission.submissionId)).toEqual([b.submission.submissionId, a.submission.submissionId]);
    await box.remove(b.submission.submissionId);
    expect(await box.list()).toHaveLength(1);
    expect(await box.get(b.submission.submissionId)).toBeUndefined();
    await box.remove("missing");
  });

  it("put overwrites by submissionId and stores copies", async () => {
    const box = new MemoryOutbox();
    const a = entry("2026-01-01T00:00:00.000Z");
    await box.put(a);
    a.attempts = 5;
    expect((await box.get(a.submission.submissionId))?.attempts).toBe(0);
    await box.put({ ...a, attempts: 2 });
    expect(await box.list()).toHaveLength(1);
    expect((await box.get(a.submission.submissionId))?.attempts).toBe(2);
    const fetched = await box.get(a.submission.submissionId);
    fetched!.attempts = 99;
    expect((await box.get(a.submission.submissionId))?.attempts).toBe(2);
  });
});

describe("createOutbox", () => {
  it("falls back to memory when indexedDB is undefined", async () => {
    const original = (globalThis as { indexedDB?: unknown }).indexedDB;
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    try {
      const box = createOutbox() as FallbackOutbox;
      expect(await box.kind()).toBe("memory");
      const e = entry("2026-01-01T00:00:00.000Z");
      await box.put(e);
      expect(await box.list()).toHaveLength(1);
    } finally {
      (globalThis as { indexedDB?: unknown }).indexedDB = original;
    }
  });

  it("falls back to memory when open fails", async () => {
    const factory = {
      open() {
        const req = { error: new DOMException("private mode", "InvalidStateError") } as unknown as IDBOpenDBRequest;
        queueMicrotask(() => req.onerror?.(new Event("error")));
        return req;
      },
    } as unknown as IDBFactory;
    const box = new FallbackOutbox({ indexedDB: factory });
    expect(await box.kind()).toBe("memory");
  });

  it("falls back to memory when open throws or hangs", async () => {
    const throwing = { open: () => { throw new Error("SecurityError"); } } as unknown as IDBFactory;
    expect(await new FallbackOutbox({ indexedDB: throwing }).kind()).toBe("memory");
    const hanging = { open: () => ({}) } as unknown as IDBFactory;
    expect(await new FallbackOutbox({ indexedDB: hanging, probeTimeoutMs: 10 }).kind()).toBe("memory");
  });

  it("IndexedDbOutbox rejects when IndexedDB is missing", async () => {
    const original = (globalThis as { indexedDB?: unknown }).indexedDB;
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    try {
      await expect(new IndexedDbOutbox().list()).rejects.toThrow(/not available/);
    } finally {
      (globalThis as { indexedDB?: unknown }).indexedDB = original;
    }
  });
});
