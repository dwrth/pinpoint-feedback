import type { MessagesOf } from "./format";

export const enCapture = {} as const;

export type CaptureMessages = MessagesOf<typeof enCapture>;
