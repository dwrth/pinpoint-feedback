export {
  parseUserAgent,
  parseBrowser,
  parseOs,
  applyUserAgentData,
  detectEnvironment,
  type ParsedUserAgent,
  type UserAgentBrand,
  type UserAgentDataLike,
  type EnvironmentHints,
} from "./user-agent";
export {
  BrowserMetadataCollector,
  collectBrowserMetadata,
  type BrowserMetadataCollectorOptions,
} from "./metadata";
export {
  HttpFeedbackTransport,
  buildFormData,
  interpretResponse,
  parseRetryAfter,
  isAbortFailure,
  type HttpFeedbackTransportOptions,
} from "./transport";
export {
  MemoryOutbox,
  IndexedDbOutbox,
  FallbackOutbox,
  createOutbox,
  OUTBOX_DB_NAME,
  OUTBOX_STORE_NAME,
  type IndexedDbOutboxOptions,
  type CreateOutboxOptions,
} from "./outbox";
export {
  fitImageToSize,
  searchImageEncoding,
  ImageTooLargeError,
  type EncodeRequest,
  type ImageEncodeFn,
  type EncodingSearchOptions,
  type EncodingSearchResult,
  type FitImageResult,
} from "./image";
export {
  createFeedbackClient,
  isRetryable,
  isPermanentFailure,
  computeBackoffDelay,
  type BackoffOptions,
  type CreateFeedbackClientOptions,
} from "./client";
