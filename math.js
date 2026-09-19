const FUNCTION_COMMANDS = new Set([
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "ln",
  "log",
  "exp"
]);

const MATH_RUN_RE = /[A-Za-z0-9_()\[\]{}.+\-*\/^=<>|\u03c0\u03a3\u2211\u222b\u221e\u5230\\ \t\u00b7\u00d7\u2212]+/g;
const COMPARISON_WORDS = "(?:\\u5c0f\\u4e8e\\u7b49\\u4e8e|\\u5927\\u4e8e\\u7b49\\u4e8e|\\u5c0f\\u4e8e|\\u5927\\u4e8e|<=|>=|<|>|\\u2264|\\u2265)";
const MATH_RUN_SOURCE = "[A-Za-z0-9_()\\[\\]{}.+\\-*\\/^=<>|\\u03c0\\u03a3\\u2211\\u222b\\u221e\\u5230\\\\ \\t\\u00b7\\u00d7\\u2212]+";
const CHOICE_LABEL_PREFIX_RE = new RegExp(
  "^\\s*(?:(?:[A-D][.\\uFF0E\\u3001)\\uFF09])|(?:\\([A-D]\\))|(?:\\uFF08[A-D]\\uFF09))\\s*",
  "i"
);
const INEQUALITY_RE = new RegExp(
  `${MATH_RUN_SOURCE}${COMPARISON_WORDS}${MATH_RUN_SOURCE}(?:${COMPARISON_WORDS}${MATH_RUN_SOURCE})*`,
  "g"
);

function normalizePlainTextFormula(input) {
  return String(input || "")
    .replace(/\r\n?/g, " ")
    .replace(/\\+\*/g, "*")
    .replace(/\\cdot/g, "*")
    .replace(/[\u00b7\u00d7]/g, "*")
    .replace(/\u2212/g, "-")
    .replace(/\u2192/g, "->")
    .replace(/\u2264/g, "<=")
    .replace(/\u2265/g, ">=")
    .replace(/\u2260/g, "!=")
    .replace(/\u03c0/g, "pi ")
    .replace(/[\u03a3\u2211]/g, "sum ")
    .replace(/\u222c/g, " double integral ")
    .replace(/\u222b/g, " integral ")
    .replace(/\u221e/g, "infinity")
    .replace(/\\+iint(?![A-Za-z])/gi, "double integral")
    .replace(/\\+sum\b/gi, "sum")
    .replace(/\\+(?:infty|infinity)\b/gi, "infinity")
    .replace(/\b(?:infty|inf)\b/gi, "infinity")
    .replace(/\u65e0\u7a77\u5927/g, "infinity")
    .replace(/\u5c0f\u4e8e\u7b49\u4e8e/g, "<=")
    .replace(/\u5927\u4e8e\u7b49\u4e8e/g, ">=")
    .replace(/\u5c0f\u4e8e/g, "<")
    .replace(/\u5927\u4e8e/g, ">")
    .replace(/\\to/g, "->")
    .replace(/\\?lim\s*_\s*\{\s*([A-Za-z][A-Za-z0-9_]*)\s*->\s*([^{}]+?)\s*\}/gi, "lim $1->$2")
    .replace(/\\?lim([A-Za-z])(?=\s*->)/gi, "lim $1")
    .replace(/\|\s*([A-Za-z0-9_().+\-*/^{}\[\]]+)\s*\u5230\s*([A-Za-z0-9_().+\-*/^{}\[\]]+)/g, "|_$1^$2")
    .replace(/\bintegral\s*(?:\u4ece\s*)?([A-Za-z0-9_().+\-*/^{}\[\]]+)\s*\u5230\s*([A-Za-z0-9_().+\-*/^{}\[\]]+)/gi, "integral_$1^$2");
}

function skipWhitespace(value, index) {
  let cursor = index;
  while (/\s/.test(value[cursor] || "")) cursor += 1;
  return cursor;
}

function isFormulaBoundary(value, index) {
  return index === 0 || !/[A-Za-z0-9_]/.test(value[index - 1] || "");
}

function findClosingDelimiter(value, start, open, close) {
  if (value[start] !== open) return -1;

  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === open) depth += 1;
    if (value[index] === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function getSummationPrefixLength(value, index = 0) {
  const prefix = value.slice(index).match(/^(?:\\+)?sum/i);
  if (!prefix) return 0;

  const suffix = value.slice(index + prefix[0].length);
  const compactSuffix = suffix.replace(/^\s+/, "");
  if (/^[_{[(]/.test(compactSuffix)) return prefix[0].length;
  if (/^[A-Za-z]\s*=/.test(compactSuffix)) return prefix[0].length;
  return 0;
}

function getRawSummationPrefixLength(value, index) {
  const first = value[index] || "";
  if (first === "\u03a3" || first === "\u2211") {
    const suffix = value.slice(index + 1).replace(/^\s+/, "");
    return /^[_{[(]/.test(suffix) || /^[A-Za-z]\s*=/.test(suffix) ? 1 : 0;
  }
  return getSummationPrefixLength(value, index);
}

function findSummationEnd(value, start) {
  const prefixLength = getRawSummationPrefixLength(value, start);
  if (!prefixLength) return -1;

  const run = value.slice(start).match(/^[A-Za-z0-9_()\[\]{}.+\-*\/^=<>|\u03c0\u03a3\u2211\u222b\u221e\u5230\\ \t\u00b7\u00d7\u2212]+/);
  if (!run || run[0].length <= prefixLength) return -1;
  return start + run[0].length;
}

function getDoubleIntegralPrefixLength(value, index = 0) {
  const prefix = value.slice(index).match(/^double\s*integral(?![A-Za-z])/i);
  return prefix ? prefix[0].length : 0;
}

function getRawDoubleIntegralPrefixLength(value, index) {
  if (value[index] === "\u222c") return 1;
  const prefix = value.slice(index).match(/^(?:double\s*integral|\\+iint)(?![A-Za-z])/i);
  return prefix ? prefix[0].length : 0;
}

function findDoubleIntegralEnd(value, start) {
  const prefixLength = getRawDoubleIntegralPrefixLength(value, start);
  if (!prefixLength) return -1;

  const source = value.slice(start);
  const match = source.match(/^(?:double\s*integral|\\+iint|\u222c)[\s\S]*?d\s*[A-Za-z]\s*d\s*[A-Za-z](?![A-Za-z0-9_])/i);
  return match ? start + match[0].length : -1;
}

function findTruncatedFunctionCallEnd(value, start) {
  const argument = "(?:[A-Za-z][A-Za-z0-9_]*|\\d+(?:\\.\\d+)?)";
  const expression = new RegExp(
    `^[A-Za-z][A-Za-z0-9_]*\\(\\s*${argument}(?:\\s*,\\s*${argument})+\\s*(?=\\s*(?:$|[\\u4e00-\\u9fff\\u3002\\uff0c\\uff1b\\uff01\\uff1f]))`
  );
  const match = value.slice(start).match(expression);
  return match ? start + match[0].length : -1;
}

function isTruncatedFunctionCall(value) {
  return findTruncatedFunctionCallEnd(value, 0) === value.length;
}

function trimFormulaRange(value, start, end) {
  let trimmedStart = start;
  let trimmedEnd = end;

  while (trimmedStart < trimmedEnd && /\s/.test(value[trimmedStart])) trimmedStart += 1;
  while (trimmedEnd > trimmedStart && /\s/.test(value[trimmedEnd - 1])) trimmedEnd -= 1;
  while (trimmedEnd > trimmedStart && /[=+\-*\/<>·×−]/.test(value[trimmedEnd - 1])) trimmedEnd -= 1;

  return { start: trimmedStart, end: trimmedEnd };
}

function trimChoiceLabelPrefix(value, start, end) {
  const match = value.slice(start, end).match(CHOICE_LABEL_PREFIX_RE);
  return match ? start + match[0].length : start;
}

function ungroupForFraction(value) {
  return String(value).replace(/^\\left\(([^]*)\\right\)$/, "$1");
}

function convertExpression(source) {
  const value = normalizePlainTextFormula(source).trim();
  let index = 0;

  function atStop(stop) {
    return Boolean(stop) && value[index] === stop;
  }

  function readGroup(open, close, left, right) {
    if (value[index] !== open) return "";
    index += 1;
    const inner = parseExpression(close);
    index = skipWhitespace(value, index);
    if (value[index] === close) index += 1;
    return `${left}${inner}${right}`;
  }

  function readScript() {
    index = skipWhitespace(value, index);
    const start = value[index];
    if (start === "(" || start === "[" || start === "{") {
      const close = start === "(" ? ")" : start === "[" ? "]" : "}";
      index += 1;
      const inner = parseExpression(close);
      index = skipWhitespace(value, index);
      if (value[index] === close) index += 1;
      return `{${inner}}`;
    }

    const match = value.slice(index).match(/^[+-]?(?:\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_]*)/);
    if (!match) return "";
    index += match[0].length;
    return `{${convertExpression(match[0])}}`;
  }

  function readIntegralBound(allowAttachedExponent = false) {
    index = skipWhitespace(value, index);
    const start = value[index];
    if (start === "(" || start === "[" || start === "{") {
      const close = start === "(" ? ")" : start === "[" ? "]" : "}";
      const end = findClosingDelimiter(value, index, start, close);
      if (end < 0) return "";
      const raw = value.slice(index + 1, end);
      index = end + 1;
      return convertExpression(raw);
    }

    const base = value.slice(index).match(/^[+-]?(?:\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_]*)/);
    if (!base) return "";
    let raw = base[0];
    index += raw.length;

    const exponentStart = skipWhitespace(value, index);
    if (allowAttachedExponent && value[exponentStart] === "^") {
      index = exponentStart + 1;
      const exponent = value.slice(index).match(/^(?:[+-]?(?:\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_]*)|\([^)]*\)|\[[^\]]*\]|\{[^}]*\})/);
      if (exponent) {
        raw += "^" + exponent[0];
        index += exponent[0].length;
      } else {
        index = exponentStart;
      }
    }
    return convertExpression(raw);
  }

  function findIntegralDifferential(start) {
    for (let cursor = start; cursor < value.length; cursor += 1) {
      if (value[cursor] === "=" || /[，。；！？]/.test(value[cursor] || "")) return null;
      if (
        cursor > start
        && value.slice(cursor).toLowerCase().startsWith("integral")
        && isFormulaBoundary(value, cursor)
      ) {
        return null;
      }
      if (value[cursor] !== "d" || /[A-Za-z_]/.test(value[cursor - 1] || "")) continue;
      const differential = value.slice(cursor).match(/^d\s*([A-Za-z])(?![A-Za-z0-9_])/);
      if (differential) {
        return {
          start: cursor,
          end: cursor + differential[0].length,
          variable: differential[1]
        };
      }
    }
    return null;
  }

  function readIntegral() {
    const boundsStart = index;
    let lowerBound = "";
    let upperBound = "";

    index = skipWhitespace(value, index);
    if (value[index] === "_") {
      index += 1;
      lowerBound = readIntegralBound();
    }

    index = skipWhitespace(value, index);
    if (value[index] === "^") {
      index += 1;
      upperBound = readIntegralBound(true);
    }

    const integrandStart = skipWhitespace(value, index);
    const differential = findIntegralDifferential(integrandStart);
    const integrand = differential ? value.slice(integrandStart, differential.start).trim() : "";
    if (!differential || !integrand) {
      index = boundsStart;
      return "integral";
    }

    index = differential.end;
    let latex = "\\int";
    if (lowerBound) latex += "_{" + lowerBound + "}";
    if (upperBound) latex += "^{" + upperBound + "}";
    return latex + " " + convertExpression(integrand) + "\\,\\mathrm{d}" + differential.variable;
  }

  function findDoubleIntegralDifferential(start) {
    for (let cursor = start; cursor < value.length; cursor += 1) {
      if (value[cursor] === "=" || /[锛屻€傦紱锛侊紵]/.test(value[cursor] || "")) return null;
      if (value[cursor] !== "d") continue;
      const differential = value.slice(cursor).match(/^d\s*([A-Za-z])\s*d\s*([A-Za-z])(?![A-Za-z0-9_])/);
      if (differential) {
        return {
          start: cursor,
          end: cursor + differential[0].length,
          firstVariable: differential[1],
          secondVariable: differential[2]
        };
      }
    }
    return null;
  }

  function readDoubleIntegral() {
    const boundsStart = index;
    let lowerBound = "";
    let upperBound = "";

    index = skipWhitespace(value, index);
    if (value[index] === "_") {
      index += 1;
      lowerBound = readIntegralBound();
    }

    index = skipWhitespace(value, index);
    if (value[index] === "^") {
      index += 1;
      upperBound = readIntegralBound(true);
    }

    const integrandStart = skipWhitespace(value, index);
    const differential = findDoubleIntegralDifferential(integrandStart);
    const integrand = differential ? value.slice(integrandStart, differential.start).trim() : "";
    if (!differential || !integrand) {
      index = boundsStart;
      return "double integral";
    }

    index = differential.end;
    let latex = "\\iint";
    if (lowerBound) latex += "_{" + lowerBound + "}";
    if (upperBound) latex += "^{" + upperBound + "}";
    return `${latex} ${convertExpression(integrand)}\\,\\mathrm{d}${differential.firstVariable}\\,\\mathrm{d}${differential.secondVariable}`;
  }

  function readSummation() {
    const boundsStart = index;
    let lowerBound = "";
    let upperBound = "";

    index = skipWhitespace(value, index);
    if (value[index] === "_") {
      index += 1;
      lowerBound = readIntegralBound();

      index = skipWhitespace(value, index);
      if (value[index] === "^") {
        index += 1;
        upperBound = readIntegralBound(true);
      }
    } else {
      const lowerStart = index;
      const separator = value.indexOf("\u5230", lowerStart);
      if (separator >= lowerStart) {
        const rawLowerBound = value.slice(lowerStart, separator).trim();
        if (rawLowerBound) lowerBound = convertExpression(rawLowerBound);
        index = separator + 1;
        upperBound = readIntegralBound(true);
      }
    }

    if (!lowerBound && !upperBound) {
      index = boundsStart;
      return "sum";
    }

    const summand = value.slice(skipWhitespace(value, index)).trim();
    index = value.length;

    let latex = "\\sum";
    if (lowerBound) latex += "_{" + lowerBound + "}";
    if (upperBound) latex += "^{" + upperBound + "}";
    return summand ? latex + " " + convertExpression(summand) : latex;
  }

  function readEvaluationBar() {
    index += 1;
    let lowerBound = "";
    let upperBound = "";

    index = skipWhitespace(value, index);
    if (value[index] === "_") {
      index += 1;
      lowerBound = readIntegralBound();
    }

    index = skipWhitespace(value, index);
    if (value[index] === "^") {
      index += 1;
      upperBound = readIntegralBound(true);
    }

    if (!lowerBound && !upperBound) return "|";
    let latex = "\\Big|";
    if (lowerBound) latex += "_{" + lowerBound + "}";
    if (upperBound) latex += "^{" + upperBound + "}";
    return latex;
  }

  function parsePrimary(stop) {
    index = skipWhitespace(value, index);
    if (!value[index] || atStop(stop)) return "";

    if (value[index] === "+" || value[index] === "-") {
      const sign = value[index];
      index += 1;
      const primary = parsePrimary(stop);
      return primary ? `${sign}${primary}` : sign;
    }

    if (value[index] === "(") return readGroup("(", ")", "\\left(", "\\right)");
    if (value[index] === "[") return readGroup("[", "]", "\\left[", "\\right]");
    if (value[index] === "{") return readGroup("{", "}", "\\left\\{", "\\right\\}");
    if (value[index] === "|") return readEvaluationBar();

    const number = value.slice(index).match(/^\d+(?:\.\d+)?/);
    if (number) {
      index += number[0].length;
      return number[0];
    }

    if (
      value.slice(index).toLowerCase().startsWith("integral")
      && !/[A-Za-z0-9]/.test(value[index + "integral".length] || "")
    ) {
      index += "integral".length;
      return readIntegral();
    }

    const doubleIntegralPrefixLength = getDoubleIntegralPrefixLength(value, index);
    if (doubleIntegralPrefixLength) {
      index += doubleIntegralPrefixLength;
      return readDoubleIntegral();
    }

    const summationPrefixLength = getSummationPrefixLength(value, index);
    if (summationPrefixLength) {
      index += summationPrefixLength;
      return readSummation();
    }

    const identifier = value.slice(index).match(/^[A-Za-z][A-Za-z0-9_]*/);
    if (identifier) {
      const name = identifier[0];
      index += name.length;
      let latex = name === "infinity"
        ? "\\infty"
        : name === "pi"
          ? "\\pi"
          : FUNCTION_COMMANDS.has(name)
            ? `\\${name}`
            : name;

      const groupStart = skipWhitespace(value, index);
      if (value[groupStart] === "(") {
        index = groupStart;
        if (name === "sqrt") {
          index += 1;
          const inner = parseExpression(")");
          index = skipWhitespace(value, index);
          if (value[index] === ")") index += 1;
          latex = `\\sqrt{${inner}}`;
        } else {
          latex += readGroup("(", ")", "\\left(", "\\right)");
        }
      }
      return latex;
    }

    if (value.startsWith("...", index)) {
      index += 3;
      return "\\cdots";
    }

    const char = value[index];
    index += 1;
    return char;
  }

  function parsePower(stop) {
    let latex = parsePrimary(stop);
    if (!latex) return "";

    while (true) {
      index = skipWhitespace(value, index);
      const operator = value[index];
      if (operator !== "^" && operator !== "_") break;
      index += 1;
      const script = readScript();
      if (!script) break;
      latex += `${operator}${script}`;
    }
    return latex;
  }

  function beginsPrimary(stop) {
    const char = value[index] || "";
    if (!char || atStop(stop)) return false;
    return /[A-Za-z0-9([{|]/.test(char);
  }

  function parseTerm(stop) {
    let latex = parsePower(stop);
    if (!latex) return "";

    while (true) {
      index = skipWhitespace(value, index);
      if (atStop(stop)) break;
      const operator = value[index];

      if (operator === "*") {
        index += 1;
        const right = parsePower(stop);
        if (!right) break;
        latex += `\\cdot ${right}`;
        continue;
      }

      if (operator === "/") {
        index += 1;
        const right = parsePower(stop);
        if (!right) break;
        latex = `\\frac{${ungroupForFraction(latex)}}{${ungroupForFraction(right)}}`;
        continue;
      }

      if (beginsPrimary(stop)) {
        const right = parsePower(stop);
        if (!right) break;
        latex += ` ${right}`;
        continue;
      }

      break;
    }
    return latex;
  }

  function readRelationOperator() {
    if (value.startsWith("<=", index)) {
      index += 2;
      return "\\le";
    }
    if (value.startsWith(">=", index)) {
      index += 2;
      return "\\ge";
    }
    if (value.startsWith("!=", index)) {
      index += 2;
      return "\\ne";
    }
    if (value[index] === "<") {
      index += 1;
      return "<";
    }
    if (value[index] === ">") {
      index += 1;
      return ">";
    }
    if (value[index] === "=" || value[index] === "+" || value[index] === "-") {
      const operator = value[index];
      index += 1;
      return operator;
    }
    return "";
  }

  function parseExpression(stop) {
    let latex = parseTerm(stop);
    if (!latex) return "";

    while (true) {
      index = skipWhitespace(value, index);
      if (atStop(stop)) break;
      const beforeOperator = index;
      if (value[index] === ",") {
        index += 1;
        const right = parseTerm(stop);
        if (!right) {
          index = beforeOperator;
          break;
        }
        latex += `, ${right}`;
        continue;
      }
      const operator = readRelationOperator();
      if (!operator) break;
      const right = parseTerm(stop);
      if (!right) {
        index = beforeOperator;
        break;
      }
      latex += ` ${operator} ${right}`;
    }
    return latex;
  }

  const converted = parseExpression("");
  return converted || value;
}

function convertLimitTarget(target) {
  const value = String(target || "").trim();
  const normalized = value.toLowerCase();
  if (normalized === "infinity" || normalized === "infty" || normalized === "inf") return "\\infty";
  if (normalized === "-infinity" || normalized === "-infty" || normalized === "-inf") return "-\\infty";
  if (normalized === "+infinity" || normalized === "+infty" || normalized === "+inf") return "+\\infty";
  const directional = value.match(/^(.+)([+-])$/);
  if (directional && directional[1]) return `${convertExpression(directional[1])}^{${directional[2]}}`;
  return convertExpression(value);
}

function convertDerivative(value) {
  const match = value.match(/^d\/d([A-Za-z])\s*\[([\s\S]+)\]$/);
  if (!match) return null;
  return `\\frac{\\mathrm{d}}{\\mathrm{d}${match[1]}}\\left[${convertExpression(match[2])}\\right]`;
}

function convertIntegral(value) {
  const match = value.match(/^integral(?:_([^\s^]+))?(?:\^([^\s]+))?\s+(.+?)\s+d([A-Za-z])(?:\s*(=.*))?$/i);
  if (!match) return null;

  const [, lowerBound, upperBound, integrand, variable, suffix] = match;
  const lower = lowerBound ? `_{${convertExpression(lowerBound)}}` : "";
  const upper = upperBound ? `^{${convertExpression(upperBound)}}` : "";
  const equation = suffix ? ` ${convertExpression(suffix)}` : "";
  return `\\int${lower}${upper} ${convertExpression(integrand)}\\,\\mathrm{d}${variable}${equation}`;
}

function convertLimit(value) {
  const match = value.match(/^lim\s+([A-Za-z][A-Za-z0-9_]*)\s*->\s*(infinity|-infinity|[^\s]+)(?:\s+([\s\S]+))?$/i);
  if (!match) return null;

  const [, variable, target, expression] = match;
  const body = expression ? ` ${convertExpression(expression)}` : "";
  return `\\lim_{${variable} \\to ${convertLimitTarget(target)}}${body}`;
}

function hasSupportedFormulaSyntax(source) {
  const value = normalizePlainTextFormula(source).trim();
  if (!value) return false;
  if (/^(?:lim\s+[A-Za-z]|sqrt\s*\(|integral(?:_|\s)|d\/d[A-Za-z])/i.test(value)) return true;
  if (getDoubleIntegralPrefixLength(value, 0)) return true;
  if (getSummationPrefixLength(value, 0)) return true;
  if (!/[A-Za-z0-9]/.test(value)) return false;
  return /[\^*/=<>]/.test(value)
    || (/\[[^\]]+\]/.test(value) && /[A-Za-z0-9]/.test(value))
    || (/\([^)]*\)/.test(value) && /[A-Za-z0-9]/.test(value));
}

function makeCandidate(source, start, end, priority) {
  const choiceContentStart = trimChoiceLabelPrefix(source, start, end);
  const range = trimFormulaRange(source, choiceContentStart, end);
  if (range.end <= range.start) return null;
  const raw = source.slice(range.start, range.end);
  // Compound formulas need to be claimed by their dedicated scanners. A broad
  // math run such as "y = integral1" otherwise blocks the full integral.
  if (priority < 4 && /(?:^|[^A-Za-z])(?:integral|sqrt|lim|sum|d\/d[A-Za-z])/i.test(raw)) return null;
  // Raw LaTeX is converted before plain-text formula detection in markdown.js.
  if (priority < 4 && /\\+(?:dfrac|tfrac|frac|sqrt|int|lim|begin|left|right|cdot|to)(?![A-Za-z])/i.test(raw)) return null;
  if (!hasSupportedFormulaSyntax(raw) && !(priority >= 4 && isTruncatedFunctionCall(raw))) return null;
  return {
    start: range.start,
    end: range.end,
    raw,
    latex: plainTextToLatex(raw),
    priority
  };
}

function findDerivativeEnd(value, start) {
  const prefix = value.slice(start).match(/^d\/d[A-Za-z]\s*\[/);
  if (!prefix) return -1;
  const bracketStart = start + prefix[0].lastIndexOf("[");
  const bracketEnd = findClosingDelimiter(value, bracketStart, "[", "]");
  return bracketEnd < 0 ? -1 : bracketEnd + 1;
}

function findRootEnd(value, start) {
  const prefix = value.slice(start).match(/^sqrt\s*\(/i);
  if (!prefix) return -1;
  const open = start + prefix[0].lastIndexOf("(");
  const close = findClosingDelimiter(value, open, "(", ")");
  if (close < 0) return -1;

  let end = close + 1;
  const scriptStart = skipWhitespace(value, end);
  if (value[scriptStart] === "^" || value[scriptStart] === "_") {
    end = scriptStart + 1;
    const delimiter = value[end];
    if (delimiter === "(" || delimiter === "[" || delimiter === "{") {
      const closeDelimiter = delimiter === "(" ? ")" : delimiter === "[" ? "]" : "}";
      const closeScript = findClosingDelimiter(value, end, delimiter, closeDelimiter);
      if (closeScript >= 0) end = closeScript + 1;
    } else {
      const script = value.slice(end).match(/^[+-]?(?:\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9_]*)/);
      if (script) end += script[0].length;
    }
  }
  return end;
}

function findIntegralEnd(value, start) {
  const source = value.slice(start);
  const match = source.match(/^integral[\s\S]*?d\s*[A-Za-z](?![A-Za-z0-9_])/i);
  if (!match) return -1;

  let end = match[0].length;
  const tail = source.slice(end);
  if (!/^\s*=/.test(tail)) return start + end;

  if (/^\s*=\s*\\?lim(?:\s*_\s*\{|\s*[A-Za-z])/.test(tail)) return start + end;

  const nestedIntegral = tail.search(/integral/i);
  if (nestedIntegral >= 0) return start + end;

  const punctuation = tail.search(/[\n，。；！？]/);
  end += punctuation >= 0 ? punctuation : tail.length;
  return start + end;
}

function findNestedCompoundFormulaStart(value, start, end) {
  for (let cursor = start; cursor < end; cursor += 1) {
    if (!isFormulaBoundary(value, cursor)) continue;
    const source = value.slice(cursor);
    if (
      source.toLowerCase().startsWith("integral")
      || source.toLowerCase().startsWith("sqrt")
      || source.toLowerCase().startsWith("d/d")
      || getRawSummationPrefixLength(value, cursor)
    ) {
      return cursor;
    }
  }
  return -1;
}

function expandIntegralPrefixStart(value, start) {
  const prefix = value.slice(0, start);
  const match = prefix.match(
    /(?:[A-Za-z][A-Za-z0-9_]*(?:\([^)]*\))?\s*=\s*)?(?:(?:pi|\u03c0)\s*)$/i
  );
  return match ? start - match[0].length : start;
}

function findLimitEnd(value, start) {
  const head = value.slice(start).match(
    /^(?:\\?lim)(?:\s*_\s*\{\s*[A-Za-z][A-Za-z0-9_]*\s*(?:\\to|->|\u2192)\s*[^{}]+?\s*\}|\s*[A-Za-z][A-Za-z0-9_]*\s*(?:\\to|->|\u2192)\s*(?:[+-]?(?:\\(?:infty|infinity)|infinity|infty|inf|\u65e0\u7a77\u5927|\u221e)|[A-Za-z0-9.+-]+))/i
  );
  if (!head) return -1;

  const headEnd = start + head[0].length;
  const tail = value.slice(headEnd).match(/^[ \tA-Za-z0-9_()\[\]{}.+\-*\/^=<>|\\\u03c0\u03a3\u2211\u222b\u221e\u5230\u00b7\u00d7\u2212]*/);
  if (!tail) return headEnd;

  let end = headEnd + tail[0].length;
  const nestedCompound = findNestedCompoundFormulaStart(value, headEnd, end);
  if (nestedCompound > headEnd) end = nestedCompound;
  const nestedLimit = value.slice(headEnd, end).search(/\\?lim(?:\s*_\s*\{|\s*[A-Za-z]\s*(?:\\to|->|\u2192))/i);
  if (nestedLimit > 0) end = headEnd + nestedLimit;
  const range = trimFormulaRange(value, headEnd, end);
  return Math.max(headEnd, range.end);
}

function addCandidatesFromPattern(candidates, source, pattern, priority) {
  pattern.lastIndex = 0;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const candidate = makeCandidate(source, match.index, match.index + match[0].length, priority);
    if (candidate) candidates.push(candidate);
  }
}

export function plainTextToLatex(source) {
  let value = normalizePlainTextFormula(source).trim();
  if (!value) return "";
  if (isTruncatedFunctionCall(value)) value += ")";
  return convertDerivative(value)
    || convertIntegral(value)
    || convertLimit(value)
    || convertExpression(value);
}

export function parseStandalonePlainTextFormula(line) {
  const raw = String(line || "").trim();
  const normalized = normalizePlainTextFormula(raw);
  if (CHOICE_LABEL_PREFIX_RE.test(raw)) return null;
  if (/\\+(?:dfrac|tfrac|frac|sqrt|int|lim|begin|left|right|cdot|to)(?![A-Za-z])/i.test(raw)) return null;
  if (!raw || raw.includes("`") || /[\u4e00-\u9fff]/.test(normalized) || !hasSupportedFormulaSyntax(raw)) return null;
  return plainTextToLatex(raw);
}

export function findInlinePlainTextFormulas(source) {
  const value = String(source || "");
  const candidates = [];

  for (let index = 0; index < value.length; index += 1) {
    if (!isFormulaBoundary(value, index)) continue;

    let end = -1;
    let priority = 0;
    if (value.startsWith("d/d", index)) {
      end = findDerivativeEnd(value, index);
      priority = 4;
    } else if (value.slice(index).toLowerCase().startsWith("integral")) {
      end = findIntegralEnd(value, index);
      priority = 4;
    } else if (getRawDoubleIntegralPrefixLength(value, index)) {
      end = findDoubleIntegralEnd(value, index);
      priority = 4;
    } else if (value.slice(index).toLowerCase().startsWith("sqrt")) {
      end = findRootEnd(value, index);
      priority = 4;
    } else if (getRawSummationPrefixLength(value, index)) {
      end = findSummationEnd(value, index);
      priority = 4;
    } else if (/^\\?lim(?:\s*_\s*\{|\s*[A-Za-z])/.test(value.slice(index))) {
      end = findLimitEnd(value, index);
      priority = 4;
    } else {
      end = findTruncatedFunctionCallEnd(value, index);
      priority = end > index ? 4 : 0;
    }

    if (end > index) {
      const candidateStart = priority === 4 && value.slice(index).toLowerCase().startsWith("integral")
        ? expandIntegralPrefixStart(value, index)
        : index;
      const candidate = makeCandidate(value, candidateStart, end, priority);
      if (candidate) candidates.push(candidate);
    }
  }

  addCandidatesFromPattern(candidates, value, INEQUALITY_RE, 3);
  addCandidatesFromPattern(candidates, value, MATH_RUN_RE, 1);

  candidates.sort((left, right) => (
    left.start - right.start
    || right.priority - left.priority
    || right.end - left.end
  ));

  const matches = [];
  let cursor = 0;
  for (const candidate of candidates) {
    if (candidate.start < cursor) continue;
    matches.push(candidate);
    cursor = candidate.end;
  }
  return matches;
}
