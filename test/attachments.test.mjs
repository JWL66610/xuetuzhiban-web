import test from "node:test";
import assert from "node:assert/strict";
import { MAX_FILE_BYTES, validateAttachments, describeAttachments, splitAttachmentMessage, uploadFile } from "../attachments.js";
import { parseSseChunk } from "../sse.js";

test("attachment validation accepts supported files and rejects invalid selections", () => {
  const valid = { name: "题目.PNG", size: 10 };
  assert.doesNotThrow(() => validateAttachments([valid]));
  for (const file of [
    { name: "run.exe", size: 10 }, { name: "../题目.png", size: 10 },
    { name: "empty.txt", size: 0 }, { name: "large.pdf", size: MAX_FILE_BYTES + 1 }
  ]) assert.throws(() => validateAttachments([file]));
  assert.throws(() => validateAttachments(Array(6).fill(valid)));
  assert.throws(() => validateAttachments([valid, valid], "knowledge-upload"));
  assert.doesNotThrow(() => validateAttachments([valid, valid], "chat"));
  assert.equal(describeAttachments("讲题", [{ Name: "题目.png" }, { name: "作答.jpg" }]), "讲题\n\n附件：题目.png、作答.jpg");
  assert.equal(describeAttachments("你好"), "你好");
});

test("browser uploader forwards raw bytes, encoded filename and cancellation signal", async () => {
  const file = new File(["学习资料"], "课程.txt");
  const controller = new AbortController();
  const metadata = { Name: file.name, Path: "upload/test", Size: file.size, Url: "https://example.test/download" };
  const result = await uploadFile(file, { signal: controller.signal, fetchImpl: async (url, options) => {
    assert.equal(url, "/api/upload");
    assert.equal(options.body, file);
    assert.equal(options.headers["X-File-Name"], encodeURIComponent(file.name));
    assert.equal(options.headers["Content-Type"], "application/octet-stream");
    assert.equal(options.signal, controller.signal);
    return Response.json({ file: metadata });
  } });
  assert.deepEqual(result, metadata);
  await assert.rejects(uploadFile(file, { fetchImpl: async () => Response.json({ error: "超时" }, { status: 504 }) }), /超时/);
  await assert.rejects(uploadFile(file, { fetchImpl: async () => Response.json({ file: {} }) }), /上传失败/);
  await assert.rejects(uploadFile(file, { fetchImpl: async () => new Response("too large", { status: 413 }) }), /大小限制/);
});

test("user messages separate generated upload instructions and attachment descriptions", () => {
  const input = "帮我上传到个人知识库\n保留我的换行";
  const instruction = "【资料入库目标】个人知识库\n请将本次上传的文件写入“个人知识库”知识库；若文件无法处理，请明确说明原因。";
  const query = `${input}\n\n${instruction}`;
  const full = describeAttachments(query, [{ name: "课程资料.pdf" }]);
  assert.deepEqual(splitAttachmentMessage(full), { text: input, notes: [instruction, "附件：课程资料.pdf"] });
  assert.deepEqual(splitAttachmentMessage(query), { text: input, notes: [instruction] });
  const parsed = splitAttachmentMessage(full);
  assert.equal([parsed.text, ...parsed.notes].join("\n\n"), full);
  assert.deepEqual(splitAttachmentMessage(describeAttachments("讲解这两题", [{ name: "题目.PNG" }, { name: "作答.jpg" }])), {
    text: "讲解这两题", notes: ["附件：题目.PNG、作答.jpg"]
  });
});

test("ordinary user text and incomplete upload-like phrases remain unchanged", () => {
  for (const text of ["你好", "请解释系统提示是什么意思", "第一行\n\n附件：补充说明", "【资料入库目标】个人知识库\n这是我自己写的备注", "附件：我在正文里提到的文件.pdf"]) {
    assert.deepEqual(splitAttachmentMessage(text), { text, notes: [] });
  }
});

test("SSE keeps partial events and propagates workflow failures", () => {
  const events = [];
  const rest = parseSseChunk(': ping\n\ndata: [DONE]\n\ndata: {"answer":"ok"}\n\ndata: {', (event) => events.push(event));
  assert.deepEqual(events, [{ answer: "ok" }]);
  assert.equal(rest, "data: {");
  assert.throws(() => parseSseChunk('data: {"event":"message_failed"}\n\n', () => { throw new Error("workflow failed"); }), /workflow failed/);
});
