import type { MessagesOf } from "./format";

export const enEditor = {} as const;

export type EditorMessages = MessagesOf<typeof enEditor>;
