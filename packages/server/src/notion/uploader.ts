import type { FileUploader, UploadableFile, UploadedFile } from "@pinpoint-feedback/core";
import type { NotionClientLike } from "./client";
import { NotionRequestQueue, withNotionRetry, type NotionRetryOptions } from "./reliability";

/** Notion's single-part upload limit. */
export const NOTION_SINGLE_PART_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Uploads files with Notion's File Upload API (single_part mode). The returned id must be attached
 * to a page or block within an hour or Notion discards the upload.
 */
export class NotionFileUploader implements FileUploader {
  constructor(
    private readonly client: NotionClientLike,
    private readonly queue: NotionRequestQueue = new NotionRequestQueue(),
    private readonly retry: NotionRetryOptions = {},
  ) {}

  async upload(file: UploadableFile): Promise<UploadedFile> {
    if (file.data.size > NOTION_SINGLE_PART_MAX_BYTES) {
      throw new RangeError(`File ${file.filename} exceeds Notion's 20 MB single-part upload limit.`);
    }
    const data = file.data.type === file.contentType ? file.data : new Blob([file.data], { type: file.contentType });
    return withNotionRetry(async () => {
      const created = await this.queue.run(() =>
        this.client.fileUploads.create({ mode: "single_part", filename: file.filename, content_type: file.contentType }),
      );
      const sent = await this.queue.run(() =>
        this.client.fileUploads.send({ file_upload_id: created.id, file: { filename: file.filename, data } }),
      );
      if (sent.status !== "uploaded") {
        throw Object.assign(new Error(`Notion file upload ended with status "${sent.status}".`), {
          code: "internal_server_error",
        });
      }
      return { id: created.id, filename: file.filename };
    }, this.retry);
  }
}
