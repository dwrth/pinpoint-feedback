import type { MessagesOf } from "./format";

export const enWidget = {} as const;

export type WidgetMessages = MessagesOf<typeof enWidget>;
