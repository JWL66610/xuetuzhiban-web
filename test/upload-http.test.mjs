import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { MAX_FILE_BYTES } from "../attachments.js";

test("HTTP upload sends raw bytes then forwards metadata to agent Files", async (context) => {
  let chatPayload;
  let upHeaders;
  let upBody;
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (request.url.startsWith("/up?")) {
      upHeaders = request.headers;
      upBody = body;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ Result: { Path: "upload/test", Size: body.length } }));
    } else if (request.url === "/chat_query_v2") {
      chatPayload = JSON.parse(body);
      assert.equal(request.headers.apikey, "test-key-not-real");
      response.setHeader("Content-Type", "text/event-stream");
      response.end('data: {"event":"message","answer":"ok"}\n\n');
    } else {
      response.writeHead(404).end();
    }
  }).listen(0, "127.0.0.1");
  await once(upstream, "listening");
  context.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
  const overrides = {
    HIAGENT_UP_ENDPOINT: upstreamOrigin, HIAGENT_UP_AUTH_MODE: "direct", HIAGENT_API_BASE_URL: upstreamOrigin,
    HIAGENT_API_KEY: "test-key-not-real", HIAGENT_FILE_DOWNLOAD_URL: `${upstreamOrigin}/download`
  };
  const previous = Object.fromEntries(Object.keys(overrides).map((name) => [name, process.env[name]]));
  Object.assign(process.env, overrides);
  context.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const { app } = await import("../server.mjs");
  const local = app.listen(0, "127.0.0.1");
  await once(local, "listening");
  context.after(() => { local.closeAllConnections(); local.close(); });
  const origin = `http://127.0.0.1:${local.address().port}`;
  const bytes = Buffer.from("Synthetic upload test");
  const response = await fetch(`${origin}/api/upload`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent("资料.txt") }, body: bytes
  });
  assert.equal(response.status, 200);
  const { file } = await response.json();
  assert.equal(file.Name, "资料.txt");
  assert.deepEqual(upBody, bytes);
  assert.equal(upHeaders.authorization, undefined);
  assert.equal(upHeaders.apikey, undefined);
  const chat = await fetch(`${origin}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "test", conversationId: "test-conv", query: "阅读附件", files: [file] })
  });
  assert.equal(chat.status, 200);
  assert.match(await chat.text(), /answer/);
  assert.deepEqual(chatPayload.QueryExtends.Files, [file]);
  const oversized = await fetch(`${origin}/api/upload`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Name": "large.pdf" }, body: Buffer.alloc(MAX_FILE_BYTES + 1)
  });
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).error, /20 MB/);
  const empty = await fetch(`${origin}/api/upload`, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Name": "empty.txt" } });
  assert.equal(empty.status, 400);
});
