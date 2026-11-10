import type { Client } from "@notionhq/client";

/** The subset of the Notion SDK client used by this package (lets tests inject a fake). */
export interface NotionClientLike {
  databases: Pick<Client["databases"], "retrieve">;
  dataSources: Pick<Client["dataSources"], "retrieve" | "update" | "query">;
  pages: Pick<Client["pages"], "create">;
  blocks: { children: Pick<Client["blocks"]["children"], "append"> };
  fileUploads: Pick<Client["fileUploads"], "create" | "send">;
}

export type CreatePageArgs = Parameters<Client["pages"]["create"]>[0];
export type UpdateDataSourceArgs = Parameters<Client["dataSources"]["update"]>[0];
export type QueryDataSourceArgs = Parameters<Client["dataSources"]["query"]>[0];
export type AppendChildrenArgs = Parameters<Client["blocks"]["children"]["append"]>[0];
export type BlockRequest = AppendChildrenArgs["children"][number];
