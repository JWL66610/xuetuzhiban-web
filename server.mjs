import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { readUploadConfig, uploadToPlatform } from "./upload-service.mjs";
import { MAX_ATTACHMENTS, MAX_FILE_BYTES } from "./attachments.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
const port = Number(process.env.PORT || 5173);

const browserPlatformConfigs = new Map();
const MAX_BROWSER_CONFIGS = 1000;
const BROWSER_CONFIG_TTL_MS = 30 * 24 * 60 * 60 * 1000;

app.use(express.json({ limit: "1mb" }));
app.use(
  "/vendor/katex",
  express.static(path.join(__dirname, "node_modules", "katex", "dist"), {
    maxAge: "7d",
    immutable: true
  })
);
app.use(express.static(__dirname));

function normalizeClientId(value) {
  const clientId = String(value || "").trim();
  return /^[A-Za-z0-9_-]{8,80}$/.test(clientId) ? clientId : "";
}

function getClientId(request, allowBody = false) {
  const headerValue = request.get("X-Xuetuzhiban-Client-Id") || "";
  const bodyValue = allowBody ? String(request.body?.clientId || "") : "";
  const headerId = normalizeClientId(headerValue);
  const bodyId = normalizeClientId(bodyValue);
  if ((headerValue && !headerId) || (bodyValue && !bodyId)) return "";
  if (headerId && bodyId && headerId !== bodyId) return "";
  return headerId || bodyId;
}

function pruneBrowserConfigs() {
  const cutoff = Date.now() - BROWSER_CONFIG_TTL_MS;
  for (const [clientId, config] of browserPlatformConfigs) {
    if (config.lastSeenAt < cutoff) browserPlatformConfigs.delete(clientId);
  }
  while (browserPlatformConfigs.size >= MAX_BROWSER_CONFIGS) {
    const oldest = browserPlatformConfigs.keys().next().value;
    if (!oldest) break;
    browserPlatformConfigs.delete(oldest);
  }
}

function getPlatformConfig(request) {
  const clientId = getClientId(request);
  const browserConfig = clientId ? browserPlatformConfigs.get(clientId) : null;
  if (browserConfig) {
    browserConfig.lastSeenAt = Date.now();
    return { ...browserConfig, source: "browser" };
  }
  return { ...getServerPlatformConfig(), source: "server" };
}

function getServerPlatformConfig() {
  return {
    apiBaseUrl: (process.env.HIAGENT_API_BASE_URL || "").trim().replace(/\/+$/, ""),
    apiKey: process.env.HIAGENT_API_KEY || ""
  };
}

function isPlatformConfigured(config) {
  return Boolean(
    config?.apiBaseUrl
      && config.apiKey
      && config.apiKey !== "replace-with-your-api-key"
  );
}

function publicPlatformConfig(config) {
  return {
    ok: true,
    configured: isPlatformConfigured(config),
    apiBaseUrl: config?.apiBaseUrl || "",
    hasApiKey: Boolean(config?.apiKey && config.apiKey !== "replace-with-your-api-key"),
    source: config?.source === "browser" ? "browser" : "server"
  };
}

function parseApiBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw || raw.length > 2048) throw new Error("API 地址不能为空且不能超过 2048 个字符。");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("API 地址格式不正确。");
  }
  if (!["http:", "https:"].includes(parsed.protocol)
    || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("API 地址必须是无账号、无查询参数的 http 或 https 地址。");
  }
  return raw;
}

function parseApiKey(value) {
  const apiKey = String(value || "").trim();
  if (!apiKey || apiKey.length > 512 || apiKey === "replace-with-your-api-key" || /[\u0000-\u001f\u007f]/.test(apiKey)) {
    throw new Error("API 密钥不能为空，且长度不能超过 512 个字符。");
  }
  return apiKey;
}

function requirePlatformConfig(request, response, next) {
  const config = getPlatformConfig(request);
  if (!isPlatformConfigured(config)) {
    response.status(503).json({
      error: "尚未配置 HiAgent API，请在左下角 API 配置中填写，或在服务端环境变量中配置。"
    });
    return;
  }
  request.platformConfig = config;
  next();
}

function requireUploadConfig(request, response, next) {
  try {
    request.uploadConfig = readUploadConfig();
    next();
  } catch (error) {
    response.status(error.status || 503).json({ error: error.message });
  }
}

app.get("/api/config", (request, response) => {
  response.set("Cache-Control", "no-store");
  response.json(publicPlatformConfig(getPlatformConfig(request)));
});

app.post("/api/config", (request, response) => {
  try {
    const clientId = getClientId(request, true);
    if (!clientId) {
      response.status(400).json({ error: "客户端标识无效，请刷新页面后重试。" });
      return;
    }

    const apiBaseUrl = parseApiBaseUrl(request.body?.apiBaseUrl);
    const suppliedApiKey = String(request.body?.apiKey || "").trim();
    const existing = browserPlatformConfigs.get(clientId);
    const existingApiKey = existing?.apiBaseUrl === apiBaseUrl ? existing.apiKey : "";
    const apiKey = suppliedApiKey
      ? parseApiKey(suppliedApiKey)
      : existingApiKey;

    const serverConfig = getServerPlatformConfig();
    if (!apiKey && apiBaseUrl === serverConfig.apiBaseUrl && isPlatformConfigured(serverConfig)) {
      browserPlatformConfigs.delete(clientId);
      response.set("Cache-Control", "no-store");
      response.json(publicPlatformConfig({ ...serverConfig, source: "server" }));
      return;
    }
    if (!apiKey) {
      throw new Error("自定义 API 地址需要同时填写对应的 API 密钥。" );
    }

    browserPlatformConfigs.delete(clientId);
    pruneBrowserConfigs();
    browserPlatformConfigs.set(clientId, { apiBaseUrl, apiKey, lastSeenAt: Date.now() });
    response.set("Cache-Control", "no-store");
    response.json(publicPlatformConfig({ apiBaseUrl, apiKey, source: "browser" }));
  } catch (error) {
    response.status(400).json({ error: error.message || "API 配置无效。" });
  }
});

app.delete("/api/config", (request, response) => {
  const clientId = getClientId(request);
  if (!clientId) {
    response.status(400).json({ error: "客户端标识无效，请刷新页面后重试。" });
    return;
  }
  browserPlatformConfigs.delete(clientId);
  response.set("Cache-Control", "no-store");
  response.json(publicPlatformConfig({ ...getServerPlatformConfig(), source: "server" }));
});

function platformHeaders(config, extraHeaders = {}) {
  return {
    Apikey: config.apiKey,
    "Content-Type": "application/json",
    ...extraHeaders
  };
}

async function platformJson(endpoint, body, config) {
  const platformResponse = await fetch(`${config.apiBaseUrl}${endpoint}`, {
    method: "POST",
    headers: platformHeaders(config),
    body: JSON.stringify(body)
  });

  const responseText = await platformResponse.text();
  let data;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = { raw: responseText };
  }

  if (!platformResponse.ok) {
    const message = data?.BaseResp?.StatusMessage
      || data?.ResponseMetadata?.Error?.Message
      || data?.message
      || data?.raw
      || "平台请求失败";
    const error = new Error(message);
    error.status = platformResponse.status;
    throw error;
  }
  return data;
}

function getUserId(value) {
  const userId = String(value || "").trim();
  if (!userId) {
    throw new Error("缺少 UserID。");
  }
  if (userId.length > 20) {
    throw new Error("UserID 长度不能超过 20 个字符。");
  }
  return userId;
}

function getFileName(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

app.post("/api/conversations", requirePlatformConfig, async (request, response) => {
  try {
    const userId = getUserId(request.body.userId);
    const data = await platformJson("/create_conversation", {
      UserID: userId,
      ConversationName: request.body.conversationName || "新的学习对话"
    }, request.platformConfig);

    const conversation = data.Conversation;
    if (!conversation?.AppConversationID) {
      throw new Error("平台未返回 AppConversationID。");
    }
    response.json({
      conversationId: conversation.AppConversationID,
      conversationName: conversation.ConversationName || "新的学习对话"
    });
  } catch (error) {
    response.status(error.status || 400).json({ error: error.message || "创建会话失败" });
  }
});

app.post(
  "/api/upload",
  requireUploadConfig,
  express.raw({ type: "application/octet-stream", limit: MAX_FILE_BYTES }),
  async (request, response) => {
    const controller = new AbortController();
    const cancelUpload = () => { if (!response.writableEnded) controller.abort(); };
    response.once("close", cancelUpload);
    try {
      const file = request.body;
      const name = getFileName(request.get("X-File-Name")).trim();
      if (!Buffer.isBuffer(file) || file.length === 0 || !name) {
        response.status(400).json({ error: "请选择一个非空文件后再上传。" });
        return;
      }

      const uploaded = await uploadToPlatform(file, name, request.uploadConfig, { signal: controller.signal });
      response.json({ file: uploaded });
    } catch (error) {
      if (!response.destroyed) response.status(error.status || 502).json({ error: error.message || "文件上传失败。" });
    } finally {
      response.off("close", cancelUpload);
    }
  }
);

app.post("/api/chat", requirePlatformConfig, async (request, response) => {
  let upstream;
  let nodeStream;
  let clientClosed = false;

  const handleClientClose = () => {
    clientClosed = true;
    nodeStream?.destroy();
    upstream?.body?.cancel().catch(() => {});
  };

  response.once("close", handleClientClose);

  try {
    const userId = getUserId(request.body.userId);
    const conversationId = String(request.body.conversationId || "").trim();
    const query = String(request.body.query || "").trim();

    if (!conversationId || !query) {
      response.status(400).json({ error: "conversationId 和 query 均为必填项。" });
      return;
    }
    if (request.body.files !== undefined && (!Array.isArray(request.body.files) || request.body.files.length > MAX_ATTACHMENTS)) {
      response.status(400).json({ error: `附件参数不合法，每次最多 ${MAX_ATTACHMENTS} 个。` });
      return;
    }

    const payload = {
      UserID: userId,
      AppConversationID: conversationId,
      Query: query,
      ResponseMode: "streaming"
    };

    // The platform expects already-uploaded file metadata here. A dedicated
    // upload endpoint is intentionally kept separate so the API key is never exposed to the browser.
    if (Array.isArray(request.body.files) && request.body.files.length > 0) {
      payload.QueryExtends = { Files: request.body.files };
    }

    upstream = await fetch(`${request.platformConfig.apiBaseUrl}/chat_query_v2`, {
      method: "POST",
      headers: platformHeaders(request.platformConfig, { Accept: "text/event-stream" }),
      body: JSON.stringify(payload)
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text();
      response.status(upstream.status || 502).json({ error: text || "平台聊天请求失败" });
      return;
    }

    response.status(200);
    response.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    response.flushHeaders();

    nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.on("error", () => response.end());
    nodeStream.pipe(response);
  } catch (error) {
    if (!response.headersSent) {
      response.status(error.status || 502).json({ error: error.message || "聊天请求失败" });
    } else {
      response.end();
    }
  } finally {
    if (clientClosed) {
      upstream?.body?.cancel().catch(() => {});
    }
  }
});

app.post("/api/stop", requirePlatformConfig, async (request, response) => {
  try {
    const userId = getUserId(request.body.userId);
    const messageId = String(request.body.messageId || "").trim();
    if (!messageId) {
      response.status(400).json({ error: "缺少 messageId。" });
      return;
    }
    await platformJson("/stop_message", { UserID: userId, MessageID: messageId }, request.platformConfig);
    response.json({ ok: true });
  } catch (error) {
    response.status(error.status || 400).json({ error: error.message || "停止请求失败" });
  }
});

app.post("/api/feedback", requirePlatformConfig, async (request, response) => {
  try {
    const userId = getUserId(request.body.userId);
    const messageId = String(request.body.messageId || "").trim();
    const likeType = Number(request.body.likeType);
    if (!messageId || ![-1, 1].includes(likeType)) {
      response.status(400).json({ error: "反馈参数不正确。" });
      return;
    }
    await platformJson("/feedback", { UserID: userId, MessageID: messageId, LikeType: likeType }, request.platformConfig);
    response.json({ ok: true });
  } catch (error) {
    response.status(error.status || 400).json({ error: error.message || "提交反馈失败" });
  }
});

app.post("/api/history", requirePlatformConfig, async (request, response) => {
  try {
    const userId = getUserId(request.body.userId);
    const conversationId = String(request.body.conversationId || "").trim();
    if (!conversationId) {
      response.status(400).json({ error: "缺少 conversationId。" });
      return;
    }
    const data = await platformJson("/get_conversation_messages", {
      UserID: userId,
      AppConversationID: conversationId,
      Limit: Math.min(Math.max(Number(request.body.limit) || 50, 1), 100)
    }, request.platformConfig);
    const messages = data.Messages
      || data.MessageList
      || data.Items
      || data.Result?.Messages
      || data.Result?.MessageList
      || data.Result?.Items
      || data.Data?.Messages
      || data.Data?.MessageList
      || data.Data?.Items
      || [];
    response.json({ messages: Array.isArray(messages) ? messages : [] });
  } catch (error) {
    response.status(error.status || 400).json({ error: error.message || "获取历史消息失败" });
  }
});

app.get("/health", (request, response) => {
  let uploadConfigured = false;
  try { readUploadConfig(); uploadConfigured = true; } catch {}
  response.set("Cache-Control", "no-store");
  response.json({ ...publicPlatformConfig(getPlatformConfig(request)), uploadConfigured });
});

app.use((error, _request, response, next) => {
  if (response.headersSent) return next(error);
  if (error.type === "entity.too.large") return response.status(413).json({ error: "上传内容过大，单个附件不能超过 20 MB。" });
  response.status(error.status || 500).json({ error: "请求格式不正确，请重新选择文件后重试。" });
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(port, () => {
    console.log(`学途智伴前端已启动：http://localhost:${port}`);
  });
}
