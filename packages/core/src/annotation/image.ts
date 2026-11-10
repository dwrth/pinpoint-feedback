import type { AnnotationEditorOptions } from "../interfaces";

export interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Releases resources owned by the editor (never the caller's own image). */
  dispose(): void;
}

function waitForImage(img: HTMLImageElement): Promise<void> {
  if (img.complete && img.naturalWidth > 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
    };
    const onLoad = () => {
      done();
      resolve();
    };
    const onError = () => {
      done();
      reject(new Error("Failed to load screenshot image"));
    };
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
  });
}

async function decodeBlobWithImage(blob: Blob): Promise<LoadedImage> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await waitForImage(img);
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    dispose: () => URL.revokeObjectURL(url),
  };
}

export async function loadImage(image: AnnotationEditorOptions["image"]): Promise<LoadedImage> {
  if (typeof Blob !== "undefined" && image instanceof Blob) {
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(image);
        return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close?.() };
      } catch {
        // Some browsers cannot decode every format via createImageBitmap; fall back to <img>.
      }
    }
    return decodeBlobWithImage(image);
  }
  if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) {
    await waitForImage(image);
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => {} };
  }
  const source = image as ImageBitmap | HTMLCanvasElement;
  return { source, width: source.width, height: source.height, dispose: () => {} };
}
