import type { MessagesOf } from "./format";

export const enReport = {} as const;

export type ReportMessages = MessagesOf<typeof enReport>;
