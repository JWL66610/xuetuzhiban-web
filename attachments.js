export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;
export const FILE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.bmp,.pdf,.doc,.docx,.ppt,.pptx,.txt";
const allowedExtensions = new Set(FILE_ACCEPT.split(","));

export function validateAttachments(files, mode = "chat") {
  if (mode === "knowledge-upload" && files.length > 1) {
    throw new Error("资料入库一次只能提交一个文件，请分次上传。");
  }
  if (files.length > MAX_ATTACHMENTS) throw new Error(`每次最多添加 ${MAX_ATTACHMENTS} 个附件。`);
  for (const file of files) {
    const name = String(file.name || "").trim();
    const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
    if (!name || name.length > 255 || /[\x00-\x1f/\\]/.test(name)) {
      throw new Error("附件文件名不合法或过长，请重命名后重试。");
    }
    if (!allowedExtensions.has(extension)) throw new Error(`“${name}”格式不支持，请使用图片、PDF、Word、PPT 或 TXT。`);
    if (!Number.isFinite(file.size) || file.size <= 0) throw new Error(`“${name}”是空文件，请重新选择。`);
    if (file.size > MAX_FILE_BYTES) throw new Error(`“${name}”超过 20 MB，请压缩或拆分后上传。`);
  }
}

export function describeAttachments(query, files = []) {
  if (!files.length) return query;
  return `${query}\n\n附件：${files.map((file) => file.Name || file.name).join("、")}`;
}

export function splitAttachmentMessage(text) {
  let content = String(text || "");
  const notes = [];
  const attachment = content.match(/\n\n(附件：[^\r\n]+)$/u);
  if (attachment && allowedExtensions.has(attachment[1].slice(attachment[1].lastIndexOf(".")).toLowerCase())) {
    notes.unshift(attachment[1]);
    content = content.slice(0, attachment.index);
  }
  const instruction = content.match(/(?:^|\n\n)(【资料入库目标】([^\r\n]+)\n请将本次上传的文件写入“\2”知识库；若文件无法处理，请明确说明原因。)$/u);
  if (instruction) {
    notes.unshift(instruction[1]);
    content = content.slice(0, instruction.index);
  }
  return { text: content, notes };
}

export async function uploadFile(file, { signal, fetchImpl = fetch, headers = {} } = {}) {
  validateAttachments([file]);
  const response = await fetchImpl("/api/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
      ...headers
    },
    body: file,
    signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.file?.Path || !data.file?.Url) {
    throw new Error(data.error || (response.status === 413
      ? "附件超过上传大小限制，请压缩或拆分后重试。" : `“${file.name}”上传失败，请重试。`));
  }
  return data.file;
}
