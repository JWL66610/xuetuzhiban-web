import { createHash, createHmac, randomUUID } from "node:crypto";
import { validateAttachments } from "./attachments.js";

function uploadError(message, status = 502) {
  return Object.assign(new Error(message), { status });
}

function uploadEndpointLabel(config) {
  return `${config.baseUrl.origin}/up`;
}

function getNetworkErrorCode(error) {
  return error?.cause?.code || error?.code || "";
}

export function readUploadConfig(env = process.env) {
  const endpoint = (env.HIAGENT_UP_ENDPOINT || "").trim().replace(/\/+$/, "");
  const accessKey = (env.HIAGENT_UP_ACCESS_KEY || "").trim();
  const secretKey = (env.HIAGENT_UP_SECRET_KEY || "").trim();
  const mode = (env.HIAGENT_UP_AUTH_MODE || "auto").trim();
  if (!endpoint) throw uploadError("文件上传尚未配置，请在服务端填写 HIAGENT_UP_ENDPOINT。", 503);
  if (!["auto", "direct", "v4"].includes(mode)) throw uploadError("上传鉴权模式应为 auto、direct 或 v4。", 503);
  const signed = mode === "v4" || (mode === "auto" && Boolean(accessKey || secretKey));
  if (signed && (!accessKey || !secretKey)) throw uploadError("签名上传需要完整的 AccessKeyID 和 SecretAccessKey；运维开通旁路时可选择 direct 模式。", 503);
  let baseUrl;
  let downloadUrl;
  try {
    baseUrl = new URL(endpoint);
    const platformOrigin = env.HIAGENT_API_BASE_URL ? new URL(env.HIAGENT_API_BASE_URL).origin : "";
    downloadUrl = new URL(env.HIAGENT_FILE_DOWNLOAD_URL || `${platformOrigin}/api/proxy/down`);
    for (const url of [baseUrl, downloadUrl]) {
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
    }
    if (baseUrl.search || !["", "/", "/up"].includes(baseUrl.pathname)) throw new Error();
  } catch {
    throw uploadError("上传服务地址或平台下载地址无效。Up 地址请填写完整 Origin 或以 /up 结尾的地址。", 503);
  }
  const timeoutMs = Number(env.HIAGENT_UP_TIMEOUT_MS || 90000);
  const expire = env.HIAGENT_UP_EXPIRE ?? "3h";
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw uploadError("上传超时设置无效，范围为 1 到 300000 毫秒。", 503);
  if (expire && !/^\d+(?:\.\d+)?[smh]$/.test(expire)) throw uploadError("上传有效期格式无效，例如 3h 或 24h；留空表示长效保存。", 503);
  return {
    baseUrl, downloadUrl, signed, accessKey, secretKey, timeoutMs, expire,
    region: env.HIAGENT_UP_REGION || "cn-north-1", service: env.HIAGENT_UP_SERVICE || "up",
    accountId: env.HIAGENT_UP_ACCOUNT_ID || ""
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function createUploadHeaders(url, body, config, now = new Date()) {
  const payloadHash = sha256(body);
  const headers = { "Content-Type": "application/json", "X-Content-Sha256": payloadHash };
  if (!config.signed) return headers;
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = date.slice(0, 8);
  const canonicalHeaders = [["content-type", headers["Content-Type"]], ["host", url.host],
    ["x-content-sha256", payloadHash], ["x-date", date]];
  const signedHeaders = canonicalHeaders.map(([name]) => name).join(";");
  const query = [...url.searchParams.entries()]
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`).sort().join("&");
  const canonicalRequest = ["POST", url.pathname, query,
    canonicalHeaders.map(([name, value]) => `${name}:${value}\n`).join(""), signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${config.region}/${config.service}/request`;
  const stringToSign = ["HMAC-SHA256", date, scope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(config.secretKey, dateStamp), config.region), config.service), "request");
  return {
    ...headers, Host: url.host, "X-Date": date,
    Authorization: `HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${createHmac("sha256", signingKey).update(stringToSign).digest("hex")}`
  };
}

export function createUploadUrl(config, id = randomUUID()) {
  const url = new URL("/up", config.baseUrl);
  url.search = new URLSearchParams({ Action: "UploadRaw", Version: "2022-01-01", Id: id });
  if (config.expire) url.searchParams.set("Expire", config.expire);
  if (config.accountId) url.searchParams.set("X-Account-Id", config.accountId);
  return url;
}

export function createFileDownloadUrl(filePath, config) {
  const url = new URL(config.downloadUrl);
  url.searchParams.delete("Key");
  for (const [key, value] of Object.entries({ Action: "Download", Version: "2022-01-01", IsAnonymous: "true", Path: filePath })) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function uploadToPlatform(file, name, config, { signal, fetchImpl = fetch } = {}) {
  if (!Buffer.isBuffer(file)) throw uploadError("上传内容必须为二进制文件。", 400);
  try {
    validateAttachments([{ name, size: file.length }]);
  } catch (error) {
    throw uploadError(error.message, file.length > 20 * 1024 * 1024 ? 413 : 400);
  }
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const url = createUploadUrl(config);
  const headers = createUploadHeaders(url, file, config);
  try {
    const response = await fetchImpl(url, { method: "POST", headers, body: file, signal: combinedSignal, redirect: "error" });
    const data = await response.json().catch(() => {
      combinedSignal.throwIfAborted();
      throw uploadError("Up 服务未返回有效 JSON，请检查是否为上传服务地址。");
    });
    const apiError = data?.ResponseMetadata?.Error || data?.Error;
    if (!response.ok || apiError) {
      if ([401, 403].includes(response.status)) throw uploadError("Up 服务拒绝上传，请运维确认旁路访问权限或提供 V4 签名凭据。");
      const detail = String(apiError?.Message || data?.message || "").slice(0, 200);
      throw uploadError(`Up 服务上传失败（HTTP ${response.status}）${detail ? `：${detail}` : "。"}`);
    }
    const result = data?.Result || data;
    const filePath = result?.Path || result?.path;
    if (typeof filePath !== "string" || !filePath.trim() || /[\r\n]/.test(filePath)) throw uploadError("Up 服务未返回有效文件 Path，请检查上传服务地址。");
    const size = Number(result.Size ?? result.size ?? file.length);
    const hash = result.Sha256 ?? result.sha256;
    if (size !== file.length || (hash !== undefined && (typeof hash !== "string" || hash.toLowerCase() !== headers["X-Content-Sha256"]))) {
      throw uploadError("上传结果的文件大小或校验值不一致，请重新上传。");
    }
    return { Name: name, Path: filePath, Size: size, Url: createFileDownloadUrl(filePath, config) };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (timeout.aborted) throw uploadError("文件上传超时，请检查网络或缩小文件后重试。", 504);
    if (error.status) throw error;
    const code = getNetworkErrorCode(error);
    const endpoint = uploadEndpointLabel(config);
    if (["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "EHOSTUNREACH", "ENETUNREACH"].includes(code)) {
      const reason = code === "EHOSTUNREACH" || code === "ENETUNREACH" ? "网络不可达" : "连接超时";
      throw uploadError(`无法到达 Up 上传服务（${reason}）：${endpoint}。请检查运维服务、端口和防火墙。`);
    }
    if (["ECONNREFUSED", "ECONNRESET"].includes(code)) {
      throw uploadError(`Up 上传服务拒绝连接：${endpoint}。请确认服务正在运行且端口已放行。`);
    }
    throw uploadError(`无法连接 Up 上传服务：${endpoint}。请检查网络、防火墙和运维提供的地址。`);
  }
}
