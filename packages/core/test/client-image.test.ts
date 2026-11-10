import { describe, expect, it, vi } from "vitest";
import { ImageTooLargeError, fitImageToSize, searchImageEncoding, type EncodeRequest } from "../src/client/index";

/** Simulated encoder: size ∝ pixels × quality × per-format factor. */
function fakeEncoder(factors: Record<string, number>, bytesPerPixel = 1) {
  return vi.fn(async ({ type, quality, width, height }: EncodeRequest) => {
    const factor = factors[type];
    if (factor === undefined) return new Blob([new Uint8Array(10)], { type: "image/png" });
    const size = Math.ceil(width * height * bytesPerPixel * quality * factor);
    return new Blob([new Uint8Array(size)], { type });
  });
}

describe("fitImageToSize", () => {
  it("returns the original blob when it already fits", async () => {
    const blob = new Blob([new Uint8Array(100)], { type: "image/png" });
    const result = await fitImageToSize(blob, 100);
    expect(result).toEqual({ blob, downscaled: false, reencoded: false });
  });
});

describe("searchImageEncoding", () => {
  it("prefers webp at the highest quality that fits", async () => {
    const encode = fakeEncoder({ "image/webp": 0.5, "image/jpeg": 0.7 });
    const r = await searchImageEncoding({ width: 100, height: 100 }, 4000, encode);
    expect(r.type).toBe("image/webp");
    expect(r.quality).toBe(0.75);
    expect(r.scale).toBe(1);
    expect(r.blob.size).toBeLessThanOrEqual(4000);
  });

  it("skips formats the encoder does not support (MIME mismatch)", async () => {
    const encode = fakeEncoder({ "image/jpeg": 0.5 });
    const r = await searchImageEncoding({ width: 100, height: 100 }, 4000, encode);
    expect(r.type).toBe("image/jpeg");
    expect(encode.mock.calls.filter(([req]) => req.type === "image/webp")).toHaveLength(1);
  });

  it("downscales when quality alone is not enough and never exceeds maxBytes", async () => {
    const encode = fakeEncoder({ "image/webp": 0.5, "image/jpeg": 0.7 });
    const r = await searchImageEncoding({ width: 2000, height: 1000 }, 50_000, encode);
    expect(r.scale).toBeLessThan(1);
    expect(r.blob.size).toBeLessThanOrEqual(50_000);
    expect(r.width / r.height).toBeCloseTo(2, 1);
    expect(r.type).toBe("image/webp");
    expect(r.quality).toBe(0.75);
  });

  it("uses the more compact format for downscaling", async () => {
    const encode = fakeEncoder({ "image/webp": 0.9, "image/jpeg": 0.4 });
    const r = await searchImageEncoding({ width: 2000, height: 2000 }, 100_000, encode);
    expect(r.type).toBe("image/jpeg");
    expect(r.blob.size).toBeLessThanOrEqual(100_000);
  });

  it("throws when nothing fits above the minimum dimension", async () => {
    const encode = fakeEncoder({ "image/webp": 1 });
    await expect(searchImageEncoding({ width: 1000, height: 1000 }, 10, encode)).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it("throws when no encoder is supported", async () => {
    const encode = vi.fn(async () => null);
    await expect(searchImageEncoding({ width: 10, height: 10 }, 1, encode)).rejects.toThrow(/no supported image encoder/);
  });
});
