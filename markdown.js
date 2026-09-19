import { findInlinePlainTextFormulas, parseStandalonePlainTextFormula } from "./math.js?v=20260908-2030";

const CHOICE_LABEL_PATTERN = "(?:(?:[A-D][.\\uFF0E\\u3001)\\uFF09])|(?:\\([A-D]\\))|(?:\\uFF08[A-D]\\uFF09))";
const CHOICE_LABEL_PREFIX_RE = new RegExp(`^\\s*${CHOICE_LABEL_PATTERN}\\s*`, "i");
const CHOICE_LABEL_GLOBAL_RE = new RegExp(`(?:^|[;\\uFF1B]\\s*|\\s+)${CHOICE_LABEL_PATTERN}\\s*`, "gi");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeLink(label, href) {
  try {
    const url = new URL(href);
    if (!['http:', 'https:'].includes(url.protocol)) return label;
    return `<a href="${escapeHtml(url.toString())}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  } catch {
    return label;
  }
}

function normalizeLatexForRender(latex) {
  return String(latex || "")
    .replace(/\\+\*/g, "\\cdot ")
    .replace(/\*/g, "\\cdot ")
    .replace(/(\s*=\s*)_{1,}(?=\s*(?:$|[，。；、,.!?]))/g, "$1\\underline{\\hspace{2.6em}}");
}

function mathToken(store, latex, fallback, display = false) {
  const className = display ? "math-display" : "math-inline";
  const normalizedLatex = normalizeLatexForRender(latex);
  return store(`<${display ? "div" : "span"} class="${className}" data-math="${escapeHtml(normalizedLatex)}" aria-label="公式：${escapeHtml(fallback)}">${escapeHtml(fallback)}</${display ? "div" : "span"}>`);
}

function renderNativeInlineMath(content, store) {
  return content.replace(/(^|[^\\$])\$(?!\$)([^$\n]+?)\$(?!\$)/g, (match, prefix, latex) => {
    const source = latex.trim();
    if (!source) return match;
    return `${prefix}${mathToken(store, source, `$${latex}$`)}`;
  });
}

function findBalancedGroupEnd(value, start, open = "{", close = "}") {
  if (value[start] !== open) return -1;
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === open) depth += 1;
    if (value[index] === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function skipInlineWhitespace(value, index) {
  let cursor = index;
  while (/[ \t]/.test(value[cursor] || "")) cursor += 1;
  return cursor;
}

function findDirectLatexEnd(value, start) {
  const command = value.slice(start).match(/^\\+(?:dfrac|tfrac|frac|sqrt)(?![A-Za-z])/);
  if (!command) return -1;
  let cursor = start + command[0].length;
  if (/sqrt$/i.test(command[0])) {
    cursor = skipInlineWhitespace(value, cursor);
    if (value[cursor] === "[") {
      cursor = findBalancedGroupEnd(value, cursor, "[", "]");
      if (cursor < 0) return -1;
      cursor = skipInlineWhitespace(value, cursor);
    }
    return findBalancedGroupEnd(value, cursor);
  }
  for (let group = 0; group < 2; group += 1) {
    cursor = skipInlineWhitespace(value, cursor);
    cursor = findBalancedGroupEnd(value, cursor);
    if (cursor < 0) return -1;
  }
  return cursor;
}

function findAnswerBlankSuffix(value, start) {
  const suffix = value.slice(start).match(/^(\s*=\s*)_{1,}(?=\s*(?:$|[，。；、,.!?]))/);
  if (!suffix) return null;
  return {
    end: start + suffix[0].length,
    latex: (suffix[1].trim() || "=") + " \\underline{\\hspace{2.6em}}"
  };
}

function renderDirectLatexMath(content, store) {
  const fragments = [];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "\\" || content[index - 1] === "\\") continue;
    const commandEnd = findDirectLatexEnd(content, index);
    if (commandEnd > index) {
      const answerBlank = findAnswerBlankSuffix(content, commandEnd);
      const end = answerBlank?.end || commandEnd;
      const source = content.slice(index, commandEnd).replace(/^\\+/, "\\");
      const latex = source + (answerBlank?.latex ? " " + answerBlank.latex : "");
      fragments.push({ start: index, end, latex });
      index = end - 1;
    }
  }
  if (!fragments.length) return content;
  let cursor = 0;
  let output = "";
  for (const fragment of fragments) {
    output += content.slice(cursor, fragment.start);
    output += mathToken(store, fragment.latex, content.slice(fragment.start, fragment.end));
    cursor = fragment.end;
  }
  return output + content.slice(cursor);
}

function isChoiceLine(line) {
  return CHOICE_LABEL_PREFIX_RE.test(String(line || ""));
}

function getChoiceLabelStart(match) {
  const label = match[0].trimStart();
  return match.index + match[0].length - label.length;
}

function splitInlineChoices(value) {
  const source = String(value || "");
  const matches = [];
  CHOICE_LABEL_GLOBAL_RE.lastIndex = 0;
  for (let match = CHOICE_LABEL_GLOBAL_RE.exec(source); match; match = CHOICE_LABEL_GLOBAL_RE.exec(source)) {
    const labelStart = getChoiceLabelStart(match);
    matches.push({
    start: match.index,
    labelStart,
    labelEnd: CHOICE_LABEL_GLOBAL_RE.lastIndex
  });
}

  if (matches.length < 2) return null;

  return matches.map((match, index) => ({
    prefix: source.slice(match.start, match.labelStart),
    label: source.slice(match.labelStart, match.labelEnd),
    content: source.slice(match.labelEnd, matches[index + 1]?.start ?? source.length).replace(/[;\uFF1B]\s*$/, "")
  }));
}

function renderInline(value) {
  const tokens = [];
  const store = (html) => {
    const token = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return token;
  };

  let content = String(value);

  content = content.replace(/`([^`]+)`/g, (_match, code) => store(`<code>${escapeHtml(code)}</code>`));
  content = content.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, (_match, label, href) => {
    const link = safeLink(label ? `查看图片：${label}` : "查看图片", href);
    return link.startsWith("<a") ? store(link) : link;
  });
  content = content.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_match, label, href) => {
    const link = safeLink(label, href);
    return link.startsWith("<a") ? store(link) : link;
  });
  content = renderNativeInlineMath(content, store);
  content = renderDirectLatexMath(content, store);

  const formulas = findInlinePlainTextFormulas(content);
  if (formulas.length) {
    let cursor = 0;
    let withFormulaTokens = "";
    for (const formula of formulas) {
      withFormulaTokens += content.slice(cursor, formula.start);
      withFormulaTokens += store(`<span class="math-inline" data-math="${escapeHtml(formula.latex)}" aria-label="公式：${escapeHtml(formula.raw)}">${escapeHtml(formula.raw)}</span>`);
      cursor = formula.end;
    }
    withFormulaTokens += content.slice(cursor);
    content = withFormulaTokens;
  }

  content = escapeHtml(content)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

  return content.replace(/\u0000(\d+)\u0000/g, (_match, index) => tokens[Number(index)] || "");
}

function renderChoiceLine(line) {
  const label = String(line).match(CHOICE_LABEL_PREFIX_RE)?.[0] || "";
  return `<span class="choice-label">${escapeHtml(label)}</span>${renderInline(String(line).slice(label.length))}`;
}

function renderChoiceGroup(lines) {
  return `<div class="choice-options">${lines.map((line) => `<div class="choice-option">${renderChoiceLine(line)}</div>`).join("")}</div>`;
}

function isSingleChoiceLabel(value) {
  return /^[A-D]$/i.test(String(value || "").trim());
}

function isHorizontalRule(line) {
  return /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isBlockStart(lines, index) {
  const line = lines[index] || "";
  return /^```/.test(line)
    || /^#{1,6}\s+/.test(line)
    || isHorizontalRule(line)
    || /^>\s?/.test(line)
    || /^\s*[-+*]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || (index + 1 < lines.length && isTableDivider(lines[index + 1]));
}

export function renderMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const codeFence = line.match(/^```([^`]*)$/);
    if (codeFence) {
      const language = codeFence[1].trim();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const languageLabel = language ? ` data-language="${escapeHtml(language)}"` : "";
      blocks.push(`<pre${languageLabel}><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    const nativeDisplayMath = line.match(/^\s*\$\$([\s\S]+?)\$\$\s*$/);
    if (nativeDisplayMath) {
      const latex = nativeDisplayMath[1].trim();
      if (isSingleChoiceLabel(latex)) {
        blocks.push(`<p><span class="choice-label">${escapeHtml(latex)}</span></p>`);
      } else if (CHOICE_LABEL_PREFIX_RE.test(latex)) {
        blocks.push(renderChoiceGroup([latex]));
      } else if (latex) {
        blocks.push(mathToken((html) => html, latex, `$$${nativeDisplayMath[1]}$$`, true));
      }
      index += 1;
      continue;
    }

    if (/^\s*\$\$\s*$/.test(line)) {
      const mathLines = [];
      index += 1;
      while (index < lines.length && !/^\s*\$\$\s*$/.test(lines[index])) {
        mathLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        const latex = mathLines.join("\n").trim();
        if (isSingleChoiceLabel(latex)) {
          blocks.push(`<p><span class="choice-label">${escapeHtml(latex)}</span></p>`);
        } else if (CHOICE_LABEL_PREFIX_RE.test(latex)) {
          blocks.push(renderChoiceGroup([latex]));
        } else if (latex) {
          blocks.push(mathToken((html) => html, latex, `$$${mathLines.join("\n")}$$`, true));
        }
        index += 1;
        continue;
      }
      blocks.push(`<p>${renderInline(`$$${mathLines.join("\n")}`)}</p>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = splitTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      const headerHtml = headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("");
      const bodyHtml = rows.map((row) => `<tr>${headers.map((_header, column) => `<td>${renderInline(row[column] || "")}</td>`).join("")}</tr>`).join("");
      blocks.push(`<div class="markdown-table-wrap"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${quoteLines.map(renderInline).join("<br>")}</blockquote>`);
      continue;
    }

    const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
    if (unordered) {
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*[-+*]\s+(.+)$/);
        if (!item) break;
        items.push(`<li>${renderInline(item[1])}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*\d+[.)]\s+(.+)$/);
        if (!item) break;
        items.push(`<li>${renderInline(item[1])}</li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    const standaloneFormula = parseStandalonePlainTextFormula(line);
    if (standaloneFormula) {
      blocks.push(`<div class="math-display" data-math="${escapeHtml(normalizeLatexForRender(standaloneFormula))}" aria-label="公式：${escapeHtml(line.trim())}">${escapeHtml(line.trim())}</div>`);
      index += 1;
      continue;
    }

    const inlineChoices = splitInlineChoices(line);
    if (inlineChoices) {
      blocks.push(`<div class="choice-options choice-options-inline">${inlineChoices.map((choice) => `
        <div class="choice-option">${escapeHtml(choice.prefix)}<span class="choice-label">${escapeHtml(choice.label)}</span>${renderInline(choice.content)}</div>`).join("")}</div>`);
      index += 1;
      continue;
    }

    if (isChoiceLine(line)) {
      const choices = [];
      while (index < lines.length && lines[index].trim() && isChoiceLine(lines[index])) {
        choices.push(lines[index]);
        index += 1;
      }
      blocks.push(renderChoiceGroup(choices));
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index) && !parseStandalonePlainTextFormula(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    if (paragraph.length) {
      blocks.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
      continue;
    }

    index += 1;
  }

  return blocks.join("\n");
}
