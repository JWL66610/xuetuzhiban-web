import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readUploadConfig, createUploadUrl, createUploadHeaders, createFileDownloadUrl, uploadToPlatform } from "../upload-service.mjs";

const env = { HIAGENT_UP_ENDPOINT: "http://127.0.0.1:31011", HIAGENT_API_BASE_URL: "https://platform.test/api/app" };
const config = readUploadConfig(env);
const bytes = Buffer.from("测试资料", "utf8");
const hash = createHash("sha256").update(bytes).digest("hex");

test("configuration supports bypass and V4 without accepting incomplete credentials", () => {
  assert.equal(config.signed, false);
  assert.equal(readUploadConfig({ ...env, HIAGENT_UP_ACCESS_KEY: "ak", HIAGENT_UP_SECRET_KEY: "sk" }).signed, true);
  assert.equal(readUploadConfig({ ...env, HIAGENT_UP_AUTH_MODE: "direct", HIAGENT_UP_ACCESS_KEY: "ak" }).signed, false);
  for (const values of [{}, { ...env, HIAGENT_UP_AUTH_MODE: "v4" }, { ...env, HIAGENT_UP_ACCESS_KEY: "ak" },
    { ...env, HIAGENT_UP_ENDPOINT: "file:///tmp" }, { ...env, HIAGENT_UP_ENDPOINT: "http://name:secret@host" },
    { ...env, HIAGENT_UP_TIMEOUT_MS: "NaN" }, { ...env, HIAGENT_UP_EXPIRE: "forever" }]) {
    assert.throws(() => readUploadConfig(values), { status: 503 });
  }
});

test("upload URL and download URL follow platform protocol", () => {
  for (const endpoint of [env.HIAGENT_UP_ENDPOINT, `${env.HIAGENT_UP_ENDPOINT}/up/`]) {
    const url = createUploadUrl(readUploadConfig({ ...env, HIAGENT_UP_ENDPOINT: endpoint }), "test id");
    assert.equal(url.pathname, "/up");
    assert.equal(url.searchParams.get("Action"), "UploadRaw");
    assert.equal(url.searchParams.get("Id"), "test id");
    assert.equal(url.searchParams.get("Expire"), "3h");
  }
  assert.equal(createUploadUrl(readUploadConfig({ ...env, HIAGENT_UP_EXPIRE: "" })).searchParams.has("Expire"), false);
  const download = new URL(createFileDownloadUrl("upload/a&b", { ...config, downloadUrl: new URL("https://platform.test/api/proxy/down?Key=expired") }));
  assert.equal(download.searchParams.has("Key"), false);
  assert.equal(download.searchParams.get("Path"), "upload/a&b");
  assert.equal(download.searchParams.get("IsAnonymous"), "true");
});

test("bypass hashes raw bytes and never forwards agent credentials", () => {
  const headers = createUploadHeaders(createUploadUrl(config), bytes, config);
  assert.deepEqual(headers, { "Content-Type": "application/json", "X-Content-Sha256": hash });
});

test("V4 signing is deterministic and query-order independent", () => {
  const signed = readUploadConfig({ ...env, HIAGENT_UP_ACCESS_KEY: "ak", HIAGENT_UP_SECRET_KEY: "sk" });
  const date = new Date("2026-09-10T01:02:03Z");
  const first = createUploadHeaders(new URL("http://localhost/up?Id=abc&Action=UploadRaw"), bytes, signed, date);
  const second = createUploadHeaders(new URL("http://localhost/up?Action=UploadRaw&Id=abc"), bytes, signed, date);
  assert.deepEqual(first, second);
  assert.match(first.Authorization, /^HMAC-SHA256 Credential=ak\/20260910\/cn-north-1\/up\/request,/);
  assert.equal(first["X-Date"], "20260910T010203Z");
});

test("upload accepts wrapped and direct results and checks content integrity", async () => {
  for (const wrapped of [true, false]) {
    const result = { Path: "upload/file", Size: bytes.length, Sha256: hash };
    const output = await uploadToPlatform(bytes, "资料.txt", config, { fetchImpl: async (url, options) => {
      assert.equal(url.pathname, "/up");
      assert.equal(options.body, bytes);
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, undefined);
      return Response.json(wrapped ? { Result: result } : result);
    } });
    assert.equal(output.Name, "资料.txt");
    assert.equal(output.Size, bytes.length);
    assert.equal(new URL(output.Url).origin, "https://platform.test");
  }
});

test("upload rejects malformed, forbidden and inconsistent upstream responses", async () => {
  for (const response of [
    Response.json({}, { status: 403 }), new Response("<html>error</html>"), Response.json({}),
    Response.json({ ResponseMetadata: { Error: { Message: "not allowed" } } }),
    Response.json({ Path: "upload/file", Size: 1 }), Response.json({ Path: "upload/file", Sha256: "bad" }),
    Response.json({ Path: "upload/file", Sha256: 123 })
  ]) {
    await assert.rejects(uploadToPlatform(bytes, "资料.txt", config, { fetchImpl: async () => response }), { status: 502 });
  }
});

test("upload reports timeout and respects caller cancellation", async () => {
  const waitForAbort = async (_url, { signal }) => new Promise((_resolve, reject) => {
    const keepAlive = setInterval(() => {}, 100);
    const abort = () => { clearInterval(keepAlive); reject(signal.reason); };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
  await assert.rejects(uploadToPlatform(bytes, "资料.txt", { ...config, timeoutMs: 10 }, { fetchImpl: waitForAbort }), { status: 504 });
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(uploadToPlatform(bytes, "资料.txt", config, { signal: controller.signal, fetchImpl: waitForAbort }), /cancelled/);
});

test("upload explains common network failures with the configured endpoint", async () => {
  for (const [code, message] of [
    ["ETIMEDOUT", /连接超时/],
    ["ECONNREFUSED", /拒绝连接/],
    ["ENETUNREACH", /网络不可达/]
  ]) {
    const error = Object.assign(new Error("network failure"), { cause: { code } });
    await assert.rejects(
      uploadToPlatform(bytes, "资料.txt", config, { fetchImpl: async () => { throw error; } }),
      (caught) => caught.status === 502 && message.test(caught.message) && caught.message.includes("127.0.0.1:31011/up")
    );
  }
});
