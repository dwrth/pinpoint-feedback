#!/usr/bin/env node
/**
 * Dependency-free mock of the subset of the Notion API (version 2025-09-03) used by
 * @pinpoint-feedback/server: databases.retrieve, dataSources.retrieve/update/query,
 * pages.create, blocks.children.append and file uploads (create + multipart send).
 *
 * Test control endpoints:
 *   GET    /__mock/health
 *   GET    /__mock/pages      created pages (with `plain` property values and children)
 *   GET    /__mock/uploads    file uploads (metadata, size, leading bytes)
 *   GET    /__mock/schema     current data source properties ({properties}; select/multi_select/status
 *                              options include ids and colors, status properties also groups, like the real API;
 *                              a status property created via PATCH gets Notion's defaults: Not started /
 *                              In progress / Done in the To-do / In progress / Complete groups)
 *   GET    /__mock/requests   request log
 *   POST   /__mock/fail       {status?, code?, times?, method?, path?} make matching requests fail
 *                              (default: every POST /v1/pages; `path` may end with * for a prefix)
 *   DELETE /__mock/fail       stop failing
 *   POST   /__mock/reset      clear pages, uploads, requests and failures ({schema: true} also resets properties)
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_NOTION_PORT ?? 3999);
const HOST = process.env.MOCK_NOTION_HOST ?? "127.0.0.1";
const TOKEN = process.env.MOCK_NOTION_TOKEN ?? process.env.NOTION_API_KEY ?? "secret_test";
const NOTION_VERSION = "2025-09-03";

const hex = (id) => String(id).replace(/-/g, "").toLowerCase();
const dashed = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

const DATABASE_ID = dashed(hex(process.env.MOCK_NOTION_DATABASE_ID ?? process.env.NOTION_FEEDBACK_DATABASE_ID ?? "0123456789abcdef0123456789abcdef"));
const DATA_SOURCE_ID = dashed(hex(process.env.MOCK_NOTION_DATA_SOURCE_ID ?? "fedcba9876543210fedcba9876543210"));

let state;

function initialState() {
  return {
    properties: { Title: { id: "title", name: "Title", type: "title", title: {} } },
    pages: [],
    uploads: new Map(),
    requests: [],
    failure: undefined,
  };
}

function reset({ schema = true } = {}) {
  const properties = state?.properties;
  state = initialState();
  if (!schema && properties) state.properties = properties;
}
reset();

const now = () => new Date().toISOString();

function notionError(res, status, code, message) {
  send(res, status, { object: "error", status, code, message, request_id: randomUUID() });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(json) });
  res.end(json);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const buf = await readBody(req);
  if (buf.length === 0) return {};
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw Object.assign(new Error("Error parsing JSON body."), { status: 400, code: "invalid_json" });
  }
}

function plainText(items) {
  return Array.isArray(items) ? items.map((t) => t?.text?.content ?? t?.plain_text ?? "").join("") : "";
}

function plainValue(value) {
  if (!value || typeof value !== "object") return value;
  if ("title" in value) return plainText(value.title);
  if ("rich_text" in value) return plainText(value.rich_text);
  if ("select" in value) return value.select?.name ?? null;
  if ("status" in value) return value.status?.name ?? null;
  if ("multi_select" in value) return value.multi_select.map((o) => o.name);
  if ("url" in value) return value.url;
  if ("email" in value) return value.email;
  if ("date" in value) return value.date?.start ?? null;
  if ("files" in value) return value.files.map((f) => f.file_upload?.id ?? f.external?.url ?? f.name);
  return value;
}

function dataSourceObject() {
  return {
    object: "data_source",
    id: DATA_SOURCE_ID,
    created_time: "2025-01-01T00:00:00.000Z",
    last_edited_time: now(),
    title: [{ type: "text", text: { content: "Website feedback" }, plain_text: "Website feedback" }],
    parent: { type: "database_id", database_id: DATABASE_ID },
    database_parent: { type: "page_id", page_id: dashed("a".repeat(32)) },
    properties: state.properties,
    archived: false,
    in_trash: false,
  };
}

function databaseObject() {
  return {
    object: "database",
    id: DATABASE_ID,
    title: [{ type: "text", text: { content: "Website feedback" }, plain_text: "Website feedback" }],
    parent: { type: "page_id", page_id: dashed("a".repeat(32)) },
    data_sources: [{ id: DATA_SOURCE_ID, name: "Website feedback" }],
    is_inline: false,
    in_trash: false,
    url: `https://www.notion.so/${hex(DATABASE_ID)}`,
  };
}

function pageObject(page) {
  return {
    object: "page",
    id: page.id,
    created_time: page.created_time,
    last_edited_time: page.created_time,
    parent: { type: "data_source_id", data_source_id: DATA_SOURCE_ID, database_id: DATABASE_ID },
    archived: false,
    in_trash: false,
    url: page.url,
    properties: page.properties,
  };
}

const CHOICE_TYPES = new Set(["select", "multi_select", "status"]);

function mockError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

const newOption = (o) => ({ id: randomUUID().slice(0, 8), name: o.name, color: o.color ?? "default", description: o.description ?? null });

// Mirrors Notion: the sent `options` array is the complete list; omitted options are removed and
// options are matched to existing ones by id, then by name.
function mergeOptions(previous, sent, propertyName) {
  return sent.map((o) => {
    const match = previous.find((p) => (o.id && p.id === o.id) || (!o.id && p.name === o.name));
    if (o.id && !match) throw mockError(400, "validation_error", `Option id ${o.id} does not exist on "${propertyName}".`);
    if (!match && typeof o.name !== "string") throw mockError(400, "validation_error", `Options of "${propertyName}" need a name.`);
    if (typeof o.name === "string" && o.name.includes(",")) {
      throw mockError(400, "validation_error", "Select option names cannot contain commas.");
    }
    return match ? { ...match, ...(o.color ? { color: o.color } : {}) } : newOption(o);
  });
}

// Notion creates status properties with fixed default options and groups; the API cannot change them.
function defaultStatusConfig() {
  const options = [
    { name: "Not started", color: "default" },
    { name: "In progress", color: "blue" },
    { name: "Done", color: "green" },
  ].map(newOption);
  const group = (name, color, option) => ({ id: randomUUID().slice(0, 8), name, color, option_ids: [option.id] });
  return {
    options,
    groups: [group("To-do", "gray", options[0]), group("In progress", "blue", options[1]), group("Complete", "green", options[2])],
  };
}

function updateProperties(changes) {
  for (const [name, config] of Object.entries(changes ?? {})) {
    if (config === null) {
      delete state.properties[name];
      continue;
    }
    const type = Object.keys(config).find((k) => k !== "name" && k !== "description" && k !== "type");
    if (!type) throw mockError(400, "validation_error", `Invalid property schema for "${name}".`);
    const existing = state.properties[name];
    let typeConfig = config[type] ?? {};
    if (type === "status" && existing?.type !== "status") {
      typeConfig = defaultStatusConfig();
    } else if (type === "status") {
      typeConfig = existing.status;
    } else if (CHOICE_TYPES.has(type)) {
      const previous = (existing?.type === type ? existing[type].options : undefined) ?? [];
      const options = Array.isArray(typeConfig.options) ? mergeOptions(previous, typeConfig.options, name) : previous;
      typeConfig = { ...typeConfig, options };
    }
    state.properties[name] = { id: existing?.id ?? randomUUID().slice(0, 4), name, type, [type]: typeConfig };
  }
}

function matchesFilter(page, filter) {
  if (!filter) return true;
  if (Array.isArray(filter.and)) return filter.and.every((f) => matchesFilter(page, f));
  if (Array.isArray(filter.or)) return filter.or.some((f) => matchesFilter(page, f));
  const value = page.properties[filter.property];
  const actual = value ? plainValue(value) : undefined;
  for (const kind of ["rich_text", "title", "select", "status", "url", "email"]) {
    const cond = filter[kind];
    if (!cond) continue;
    if ("equals" in cond) return actual === cond.equals;
    if ("contains" in cond) return typeof actual === "string" && actual.includes(cond.contains);
    if ("is_empty" in cond) return !actual;
  }
  return false;
}

function useUpload(id, where) {
  const upload = state.uploads.get(hex(id));
  if (!upload) throw Object.assign(new Error(`Could not find file upload with ID: ${id}. (${where})`), { status: 400, code: "validation_error" });
  if (upload.status !== "uploaded" && upload.status !== "attached") {
    throw Object.assign(new Error(`File upload ${id} has status "${upload.status}" and cannot be attached.`), { status: 400, code: "validation_error" });
  }
  upload.status = "attached";
  upload.attachedTo.push(where);
}

function validateChildren(children) {
  if (!Array.isArray(children)) return [];
  if (children.length > 100) throw Object.assign(new Error("body.children.length should be ≤ 100."), { status: 400, code: "validation_error" });
  return children.map((block) => {
    if (!block || typeof block.type !== "string" || !(block.type in block)) {
      throw Object.assign(new Error("Invalid block."), { status: 400, code: "validation_error" });
    }
    if (block.type === "image" && block.image?.type === "file_upload") useUpload(block.image.file_upload.id, "image block");
    return { object: "block", id: randomUUID(), ...block };
  });
}

function createPage(body) {
  const parent = body.parent ?? {};
  const parentId = parent.data_source_id ?? parent.database_id;
  if (!parentId || (hex(parentId) !== hex(DATA_SOURCE_ID) && hex(parentId) !== hex(DATABASE_ID))) {
    throw Object.assign(new Error("Could not find data source."), { status: 404, code: "object_not_found" });
  }
  const properties = body.properties ?? {};
  for (const [name, value] of Object.entries(properties)) {
    const schema = state.properties[name];
    if (!schema) throw Object.assign(new Error(`${name} is not a property that exists.`), { status: 400, code: "validation_error" });
    if (!(schema.type in value)) {
      throw Object.assign(new Error(`${name} is expected to be ${schema.type}.`), { status: 400, code: "validation_error" });
    }
    const chosen =
      schema.type === "select" ? (value.select ? [value.select] : []) : schema.type === "multi_select" ? value.multi_select : [];
    for (const option of chosen) {
      if (/,/.test(option.name ?? "")) throw mockError(400, "validation_error", "Select option names cannot contain commas.");
      const options = (schema[schema.type].options ??= []);
      if (!options.some((o) => o.name === option.name)) options.push(newOption(option));
    }
    if (schema.type === "status" && value.status?.name && !(schema.status.options ?? []).some((o) => o.name === value.status.name)) {
      throw mockError(400, "validation_error", `Invalid status option "${value.status.name}" for ${name}.`);
    }
    if (schema.type === "files") {
      for (const f of value.files) if (f.type === "file_upload") useUpload(f.file_upload.id, `property ${name}`);
    }
  }
  const children = validateChildren(body.children);
  const id = randomUUID();
  const page = {
    id,
    url: `https://www.notion.so/Feedback-${hex(id)}`,
    created_time: now(),
    properties,
    children,
  };
  state.pages.push(page);
  return page;
}

async function handleFileSend(req, res, id) {
  const upload = state.uploads.get(hex(id));
  if (!upload) return notionError(res, 404, "object_not_found", `Could not find file upload with ID: ${id}.`);
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    return notionError(res, 400, "validation_error", "Content-Type must be multipart/form-data.");
  }
  const raw = await readBody(req);
  const form = await new Request("http://mock.local/", { method: "POST", headers: { "content-type": contentType }, body: raw }).formData();
  const file = form.get("file");
  if (!file || typeof file === "string") return notionError(res, 400, "validation_error", "body.file should be defined.");
  const bytes = Buffer.from(await file.arrayBuffer());
  Object.assign(upload, {
    status: "uploaded",
    content_length: bytes.length,
    received_filename: file.name,
    received_type: file.type,
    magic: bytes.subarray(0, 8).toString("hex"),
  });
  send(res, 200, publicUpload(upload));
}

function publicUpload(u) {
  return {
    object: "file_upload",
    id: u.id,
    created_time: u.created_time,
    last_edited_time: now(),
    expiry_time: u.expiry_time,
    upload_url: u.status === "pending" ? u.upload_url : null,
    archived: false,
    status: u.status,
    filename: u.filename,
    content_type: u.content_type,
    content_length: u.content_length ?? null,
  };
}

function takeFailure(method, path) {
  const f = state.failure;
  if (!f || f.times <= 0) return undefined;
  if (f.method && f.method !== method) return undefined;
  if (f.path && (f.path.endsWith("*") ? !path.startsWith(f.path.slice(0, -1)) : path !== f.path)) return undefined;
  f.times -= 1;
  f.hits += 1;
  return f;
}

async function handleApi(req, res, method, path, origin) {
  if (req.headers["notion-version"] !== NOTION_VERSION) {
    return notionError(res, 400, "missing_version", `Notion-Version header must be ${NOTION_VERSION} (got ${req.headers["notion-version"]}).`);
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    return notionError(res, 401, "unauthorized", "API token is invalid.");
  }
  const failure = takeFailure(method, path);
  if (failure) return notionError(res, failure.status, failure.code, "Mock failure injected by /__mock/fail.");

  let m;
  if (method === "GET" && (m = path.match(/^\/v1\/databases\/([^/]+)$/))) {
    if (hex(m[1]) !== hex(DATABASE_ID)) return notionError(res, 404, "object_not_found", `Could not find database with ID: ${m[1]}.`);
    return send(res, 200, databaseObject());
  }
  if ((m = path.match(/^\/v1\/data_sources\/([^/]+)(\/query)?$/))) {
    if (hex(m[1]) !== hex(DATA_SOURCE_ID)) return notionError(res, 404, "object_not_found", `Could not find data source with ID: ${m[1]}.`);
    if (method === "GET" && !m[2]) return send(res, 200, dataSourceObject());
    if (method === "PATCH" && !m[2]) {
      const body = await readJson(req);
      updateProperties(body.properties);
      return send(res, 200, dataSourceObject());
    }
    if (method === "POST" && m[2]) {
      const body = await readJson(req);
      const size = Math.min(100, body.page_size ?? 100);
      const results = state.pages.filter((p) => matchesFilter(p, body.filter)).slice(0, size).map(pageObject);
      return send(res, 200, { object: "list", results, next_cursor: null, has_more: false, type: "page_or_data_source", page_or_data_source: {} });
    }
  }
  if (method === "POST" && path === "/v1/pages") {
    const page = createPage(await readJson(req));
    return send(res, 200, pageObject(page));
  }
  if (method === "PATCH" && (m = path.match(/^\/v1\/blocks\/([^/]+)\/children$/))) {
    const page = state.pages.find((p) => hex(p.id) === hex(m[1]));
    if (!page) return notionError(res, 404, "object_not_found", `Could not find block with ID: ${m[1]}.`);
    const body = await readJson(req);
    const children = validateChildren(body.children);
    page.children.push(...children);
    return send(res, 200, { object: "list", results: children, next_cursor: null, has_more: false, type: "block", block: {} });
  }
  if (method === "POST" && path === "/v1/file_uploads") {
    const body = await readJson(req);
    if (body.mode && body.mode !== "single_part") return notionError(res, 400, "validation_error", "Only single_part uploads are mocked.");
    const id = randomUUID();
    const upload = {
      id,
      status: "pending",
      filename: body.filename ?? null,
      content_type: body.content_type ?? null,
      created_time: now(),
      expiry_time: new Date(Date.now() + 3600_000).toISOString(),
      upload_url: `${origin}/v1/file_uploads/${id}/send`,
      attachedTo: [],
    };
    state.uploads.set(hex(id), upload);
    return send(res, 200, publicUpload(upload));
  }
  if (method === "POST" && (m = path.match(/^\/v1\/file_uploads\/([^/]+)\/send$/))) return handleFileSend(req, res, m[1]);
  if (method === "GET" && (m = path.match(/^\/v1\/file_uploads\/([^/]+)$/))) {
    const upload = state.uploads.get(hex(m[1]));
    return upload ? send(res, 200, publicUpload(upload)) : notionError(res, 404, "object_not_found", "Not found.");
  }
  return notionError(res, 400, "invalid_request_url", `Mock does not implement ${method} ${path}.`);
}

async function handleMock(req, res, method, path) {
  if (path === "/__mock/health") return send(res, 200, { ok: true });
  if (method === "GET" && path === "/__mock/pages") {
    return send(res, 200, {
      pages: state.pages.map((p) => ({
        ...p,
        plain: Object.fromEntries(Object.entries(p.properties).map(([k, v]) => [k, plainValue(v)])),
      })),
    });
  }
  if (method === "GET" && path === "/__mock/uploads") {
    return send(res, 200, { uploads: [...state.uploads.values()] });
  }
  if (method === "GET" && path === "/__mock/schema") return send(res, 200, { properties: state.properties });
  if (method === "GET" && path === "/__mock/requests") return send(res, 200, { requests: state.requests });
  if (method === "POST" && path === "/__mock/fail") {
    const body = await readJson(req);
    state.failure = {
      status: body.status ?? 500,
      code: body.code ?? (body.status === 429 ? "rate_limited" : body.status === 400 ? "validation_error" : "internal_server_error"),
      times: body.times ?? Number.POSITIVE_INFINITY,
      method: body.method ?? "POST",
      path: body.path ?? "/v1/pages",
      hits: 0,
    };
    return send(res, 200, { ok: true, failure: { ...state.failure, times: String(state.failure.times) } });
  }
  if (method === "DELETE" && path === "/__mock/fail") {
    const hits = state.failure?.hits ?? 0;
    state.failure = undefined;
    return send(res, 200, { ok: true, hits });
  }
  if (method === "POST" && path === "/__mock/reset") {
    const body = await readJson(req);
    reset({ schema: body.schema === true });
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: "unknown mock endpoint" });
}

const server = createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const entry = { method, path, at: now(), status: 0 };
  res.on("finish", () => {
    entry.status = res.statusCode;
  });
  try {
    if (path.startsWith("/__mock")) return await handleMock(req, res, method, path);
    if (!path.startsWith("/v1/")) return notionError(res, 404, "invalid_request_url", "Invalid request URL.");
    state.requests.push(entry);
    await handleApi(req, res, method, path, url.origin);
  } catch (error) {
    if (res.headersSent) return;
    const status = error?.status ?? 500;
    notionError(res, status, error?.code ?? "internal_server_error", error?.message ?? "Mock error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-notion] listening on http://${HOST}:${PORT} (database ${DATABASE_ID}, data source ${DATA_SOURCE_ID})`);
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
