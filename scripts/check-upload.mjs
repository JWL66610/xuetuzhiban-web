import "dotenv/config";
import assert from "node:assert/strict";
import { readUploadConfig, uploadToPlatform } from "../upload-service.mjs";

if (!process.argv.includes("--live")) throw new Error("Use --live to explicitly upload the built-in test file.");
const content = Buffer.from("学途智伴附件联调测试。测试编号：XTZB-4817。课程：高等数学。内容：函数的极限与导数。", "utf8");
const localOption = process.argv.find((argument) => argument.startsWith("--local="));
let metadata;
if (localOption) {
  const origin = new URL(localOption.slice("--local=".length));
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname), "--local must point to a local server");
  const uploaded = await fetch(new URL("/api/upload", origin), {
    method: "POST", headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent("上传联调测试.txt") },
    body: content, signal: AbortSignal.timeout(100000)
  });
  assert.equal(uploaded.status, 200, "Local upload endpoint must succeed");
  metadata = (await uploaded.json()).file;
} else {
  metadata = await uploadToPlatform(content, "上传联调测试.txt", readUploadConfig());
}
const response = await fetch(metadata.Url, { signal: AbortSignal.timeout(15000) });
assert.equal(response.status, 200, "Platform proxy must be able to download the uploaded file");
assert.deepEqual(Buffer.from(await response.arrayBuffer()), content, "Downloaded bytes must match the uploaded bytes");
console.log(JSON.stringify({ upload: "pass", platformDownload: "pass", sha256RoundTrip: "pass", bytes: metadata.Size, name: metadata.Name }, null, 2));
