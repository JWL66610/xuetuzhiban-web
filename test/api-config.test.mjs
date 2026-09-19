import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { app } from "../server.mjs";

test("browser API configuration is isolated and used by platform requests", async (context) => {
  let receivedApiKey;
  const upstream = createServer(async (request, response) => {
    receivedApiKey = request.headers.apikey;
    for await (const _chunk of request) {}
    if (request.url === "/api/v1/create_conversation") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ Conversation: { AppConversationID: "browser-config-conversation" } }));
      return;
    }
    response.writeHead(404).end();
  }).listen(0, "127.0.0.1");
  await once(upstream, "listening");
  context.after(() => { upstream.closeAllConnections(); upstream.close(); });

  const local = app.listen(0, "127.0.0.1");
  await once(local, "listening");
  context.after(() => { local.closeAllConnections(); local.close(); });

  const localOrigin = `http://127.0.0.1:${local.address().port}`;
  const upstreamBaseUrl = `http://127.0.0.1:${upstream.address().port}/api/v1`;
  const clientId = "config-client-001";
  const headers = { "X-Xuetuzhiban-Client-Id": clientId };

  const initialResponse = await fetch(`${localOrigin}/api/config`, { headers });
  const initial = await initialResponse.json();
  assert.equal(initialResponse.status, 200);
  assert.equal(Object.hasOwn(initial, "apiKey"), false);

  const invalidResponse = await fetch(`${localOrigin}/api/config`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, apiBaseUrl: "javascript:alert(1)", apiKey: "test-key" })
  });
  assert.equal(invalidResponse.status, 400);

  const saveResponse = await fetch(`${localOrigin}/api/config`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, apiBaseUrl: upstreamBaseUrl, apiKey: "browser-test-key" })
  });
  const saved = await saveResponse.json();
  assert.equal(saveResponse.status, 200);
  assert.equal(saved.source, "browser");
  assert.equal(saved.apiBaseUrl, upstreamBaseUrl);
  assert.equal(saved.hasApiKey, true);
  assert.equal(Object.hasOwn(saved, "apiKey"), false);

  const conversationResponse = await fetch(`${localOrigin}/api/conversations`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "config-user", conversationName: "配置测试" })
  });
  assert.equal(conversationResponse.status, 200);
  assert.equal((await conversationResponse.json()).conversationId, "browser-config-conversation");
  assert.equal(receivedApiKey, "browser-test-key");

  const otherClientResponse = await fetch(`${localOrigin}/api/config`, {
    headers: { "X-Xuetuzhiban-Client-Id": "other-client-001" }
  });
  const otherClient = await otherClientResponse.json();
  assert.equal(otherClient.source, "server");
  assert.notEqual(otherClient.apiBaseUrl, upstreamBaseUrl);

  const resetResponse = await fetch(`${localOrigin}/api/config`, { method: "DELETE", headers });
  const reset = await resetResponse.json();
  assert.equal(resetResponse.status, 200);
  assert.equal(reset.source, "server");
});

