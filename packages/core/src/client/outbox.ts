import type { FeedbackOutbox, OutboxEntry } from "../interfaces";

export const OUTBOX_DB_NAME = "pinpoint-feedback";
export const OUTBOX_STORE_NAME = "outbox";
const DB_VERSION = 1;

const byCreatedAt = (a: OutboxEntry, b: OutboxEntry) =>
  a.submission.createdAt < b.submission.createdAt ? -1 : a.submission.createdAt > b.submission.createdAt ? 1 : 0;

const copy = (entry: OutboxEntry): OutboxEntry => ({ ...entry, files: { ...entry.files } });

/** Non-persistent outbox; entries live as long as the page. */
export class MemoryOutbox implements FeedbackOutbox {
  private readonly entries = new Map<string, OutboxEntry>();

  async put(entry: OutboxEntry): Promise<void> {
    this.entries.set(entry.submission.submissionId, copy(entry));
  }

  async get(submissionId: string): Promise<OutboxEntry | undefined> {
    const entry = this.entries.get(submissionId);
    return entry ? copy(entry) : undefined;
  }

  async list(): Promise<OutboxEntry[]> {
    return [...this.entries.values()].map(copy).sort(byCreatedAt);
  }

  async remove(submissionId: string): Promise<void> {
    this.entries.delete(submissionId);
  }
}

export interface IndexedDbOutboxOptions {
  indexedDB?: IDBFactory;
  dbName?: string;
  storeName?: string;
}

/** IndexedDB-backed outbox. Blobs are stored directly in the entry. */
export class IndexedDbOutbox implements FeedbackOutbox {
  private dbPromise?: Promise<IDBDatabase>;
  private readonly storeName: string;

  constructor(private readonly options: IndexedDbOutboxOptions = {}) {
    this.storeName = options.storeName ?? OUTBOX_STORE_NAME;
  }

  /** Opens (and creates/upgrades) the database. Rejects if IndexedDB is unavailable or broken. */
  open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = this.openDatabase();
      this.dbPromise.catch(() => {
        this.dbPromise = undefined;
      });
    }
    return this.dbPromise;
  }

  async put(entry: OutboxEntry): Promise<void> {
    await this.run("readwrite", (store) => store.put(entry));
  }

  async get(submissionId: string): Promise<OutboxEntry | undefined> {
    return (await this.run("readonly", (store) => store.get(submissionId))) as OutboxEntry | undefined;
  }

  async list(): Promise<OutboxEntry[]> {
    const all = (await this.run("readonly", (store) => store.getAll())) as OutboxEntry[];
    return all.sort(byCreatedAt);
  }

  async remove(submissionId: string): Promise<void> {
    await this.run("readwrite", (store) => store.delete(submissionId));
  }

  close(): void {
    void this.dbPromise?.then((db) => db.close()).catch(() => undefined);
    this.dbPromise = undefined;
  }

  private openDatabase(): Promise<IDBDatabase> {
    const factory = this.options.indexedDB ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
    if (!factory) return Promise.reject(new Error("IndexedDB is not available"));
    const storeName = this.storeName;
    return new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = factory.open(this.options.dbName ?? OUTBOX_DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Failed to open IndexedDB"));
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "submission.submissionId" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.dbPromise = undefined;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
      request.onblocked = () => reject(new Error("IndexedDB open is blocked by another connection"));
    });
  }

  private async run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let request: IDBRequest<T>;
      let tx: IDBTransaction;
      try {
        tx = db.transaction(this.storeName, mode);
        request = op(tx.objectStore(this.storeName));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("IndexedDB operation failed"));
        return;
      }
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? request.error ?? new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  }
}

export interface CreateOutboxOptions extends IndexedDbOutboxOptions {
  /** Max time to wait for IndexedDB to open before falling back to memory. Default 3000. */
  probeTimeoutMs?: number;
}

/**
 * Uses IndexedDB when it opens successfully, otherwise (SSR, Safari private mode, blocked
 * storage, a hung open) an in-memory store. If IndexedDB later fails mid-session the outbox
 * switches to memory for the rest of the page's lifetime.
 */
export class FallbackOutbox implements FeedbackOutbox {
  private backendPromise?: Promise<FeedbackOutbox>;
  private readonly memory = new MemoryOutbox();

  constructor(private readonly options: CreateOutboxOptions = {}) {}

  async kind(): Promise<"indexeddb" | "memory"> {
    return (await this.backend()) === this.memory ? "memory" : "indexeddb";
  }

  put(entry: OutboxEntry): Promise<void> {
    return this.call((b) => b.put(entry));
  }

  get(submissionId: string): Promise<OutboxEntry | undefined> {
    return this.call((b) => b.get(submissionId));
  }

  list(): Promise<OutboxEntry[]> {
    return this.call((b) => b.list());
  }

  remove(submissionId: string): Promise<void> {
    return this.call((b) => b.remove(submissionId));
  }

  private backend(): Promise<FeedbackOutbox> {
    if (!this.backendPromise) this.backendPromise = this.probe();
    return this.backendPromise;
  }

  private async probe(): Promise<FeedbackOutbox> {
    const hasFactory = this.options.indexedDB ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
    if (!hasFactory) return this.memory;
    const idb = new IndexedDbOutbox(this.options);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("IndexedDB open timed out")), this.options.probeTimeoutMs ?? 3000);
    });
    try {
      await Promise.race([idb.open(), timeout]);
      return idb;
    } catch {
      idb.close();
      return this.memory;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async call<T>(fn: (backend: FeedbackOutbox) => Promise<T>): Promise<T> {
    const backend = await this.backend();
    if (backend === this.memory) return fn(backend);
    try {
      return await fn(backend);
    } catch {
      this.backendPromise = Promise.resolve(this.memory);
      return fn(this.memory);
    }
  }
}

export function createOutbox(options?: CreateOutboxOptions): FeedbackOutbox {
  return new FallbackOutbox(options);
}
