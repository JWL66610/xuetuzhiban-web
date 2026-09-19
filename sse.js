export function parseSseChunk(buffer, onEvent) {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() || "";
  for (const block of blocks) {
    const dataLines = block.split(/\r?\n/).filter((line) => line.startsWith("data:"));
    if (!dataLines.length) continue;
    const dataText = dataLines.map((line) => line.slice(5).trim()).join("\n");
    let event;
    try {
      event = JSON.parse(dataText);
    } catch {
      continue;
    }
    onEvent(event);
  }
  return rest;
}
