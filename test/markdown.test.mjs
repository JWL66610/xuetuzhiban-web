import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../markdown.js";
import { findInlinePlainTextFormulas, plainTextToLatex } from "../math.js";

test("renders common Markdown blocks and inline formatting", () => {
  const html = renderMarkdown("# 复习计划\n\n**重点**：`夹逼准则`\n\n- 复习定义\n- 完成练习\n\n| 知识点 | 掌握度 |\n| --- | --- |\n| 极限 | 80% |");

  assert.match(html, /<h1>复习计划<\/h1>/);
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<code>夹逼准则<\/code>/);
  assert.match(html, /<ul><li>复习定义<\/li><li>完成练习<\/li><\/ul>/);
  assert.match(html, /<table>/);
});

test("escapes untrusted HTML and rejects unsafe links", () => {
  const html = renderMarkdown("<script>alert(1)</script>\n\n[危险链接](javascript:alert(1))\n\n[安全链接](https://example.com)");

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /href="https:\/\/example\.com\//);
});

test("converts the platform's plain-text formula conventions", () => {
  assert.equal(plainTextToLatex("(a)/(b)"), "\\frac{a}{b}");
  assert.equal(plainTextToLatex("sqrt(x^2 + 1)"), "\\sqrt{x^{2} + 1}");
  assert.equal(plainTextToLatex("lim x->0 (sin(x))/(x)"), "\\lim_{x \\to 0} \\frac{\\sin\\left(x\\right)}{x}");
  assert.equal(plainTextToLatex("lim x->infty (1+3/x)^x"), "\\lim_{x \\to \\infty} \\left(1 + \\frac{3}{x}\\right)^{x}");
  assert.equal(plainTextToLatex("integral_0^1 x^2 dx"), "\\int_{0}^{1} x^{2}\\,\\mathrm{d}x");
  assert.equal(plainTextToLatex("integral1到x^2 (1/t) dt"), "\\int_{1}^{x^{2}} \\left(\\frac{1}{t}\\right)\\,\\mathrm{d}t");
  assert.equal(plainTextToLatex("d/dx [x^2 + 1]"), "\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left[x^{2} + 1\\right]");
});

test("renders double integrals with compact differentials", () => {
  const source = "\u3010\u9898\u76ee\u5185\u5bb9\u3011\u8ba1\u7b97\u4e8c\u91cd\u79ef\u5206double integral_D (x^2+y) dxdy\uff0c\u5176\u4e2dD\u662f\u7531y=x^2\uff0cy=0\uff0cx=1\u56f4\u6210\u7684\u533a\u57df";
  const latex = "\\iint_{D} \\left(x^{2} + y\\right)\\,\\mathrm{d}x\\,\\mathrm{d}y";
  const formulas = findInlinePlainTextFormulas(source);
  const html = renderMarkdown(source);

  assert.equal(plainTextToLatex("double integral_D (x^2+y) dxdy"), latex);
  assert.equal(plainTextToLatex("\\iint_D (x^2+y) dx dy"), latex);
  assert.equal(plainTextToLatex("\u222c_D (x^2+y) dxdy"), latex);
  assert.equal(formulas[0]?.raw, "double integral_D (x^2+y) dxdy");
  assert.equal(formulas[0]?.latex, latex);
  assert.match(html, /data-math="\\iint_\{D\} \\left\(x\^\{2\} \+ y\\right\)\\,\\mathrm\{d\}x\\,\\mathrm\{d\}y"/);
});

test("renders chained improper-integral derivations without swallowing later formulas", () => {
  const source = "\u3010\u89e3\u6790\u3011integral_1^+\u221e (1)/(x^2) dx=lim b->+\u221e integral1\u5230b x^-2 dx=lim b->+\u221e (-1/x)|1\u5230b=lim b->+\u221e (-1/b+1)=1\u3002";
  const formulas = findInlinePlainTextFormulas(source);
  const html = renderMarkdown(source);

  assert.deepEqual(
    formulas.map((formula) => formula.raw),
    [
      "integral_1^+\u221e (1)/(x^2) dx",
      "lim b->+\u221e",
      "integral1\u5230b x^-2 dx",
      "lim b->+\u221e (-1/x)|1\u5230b",
      "lim b->+\u221e (-1/b+1)=1"
    ]
  );
  assert.equal(plainTextToLatex("lim b->+\u221e"), "\\lim_{b \\to +\\infty}");
  assert.match(html, /data-math="\\int_\{1\}\^\{b\} x\^\{-2\}\\,\\mathrm\{d\}x"/);
  assert.match(html, /data-math="\\lim_\{b \\to \+\\infty\} \\left\(\\frac\{-1\}\{x\}\\right\) \\Big\|_\{1\}\^\{b\}"/);
  assert.match(html, /data-math="\\lim_\{b \\to \+\\infty\} \\left\(\\frac\{-1\}\{b\} \+ 1\\right\) = 1"/);
  assert.doesNotMatch(html, /data-math="[^"]*integral1\u5230b/);
});

test("keeps malformed multi-variable function calls and renders summation notation", () => {
  const fillInSource = "\u3010\u9898\u76ee\u5185\u5bb9\u3011\u51fd\u6570f(x,y\u5728\u6761\u4ef6x + 2y = 4\u4e0b\u7684\u6781\u5c0f\u503c\u4e3a ________";
  const seriesSource = "\u3010\u9898\u76ee\u5185\u5bb9\u3011\u5e42\u7ea7\u6570sum n=1\u5230\u221e (x^n)/n\u7684\u6536\u655b\u57df\u4e3a ________";
  const fillInHtml = renderMarkdown(fillInSource);
  const seriesHtml = renderMarkdown(seriesSource);

  assert.equal(plainTextToLatex("f(x,y"), "f\\left(x, y\\right)");
  assert.equal(plainTextToLatex("sum n=1\u5230\u221e (x^n)/n"), "\\sum_{n = 1}^{\\infty} \\frac{x^{n}}{n}");
  assert.equal(plainTextToLatex("sum_{n=1}^{infty} (x^n)/n"), "\\sum_{n = 1}^{\\infty} \\frac{x^{n}}{n}");
  assert.equal(plainTextToLatex("\u03a3_{n=1}^{\u221e} (x^n)/n"), "\\sum_{n = 1}^{\\infty} \\frac{x^{n}}{n}");
  assert.match(fillInHtml, /data-math="f\\left\(x, y\\right\)"/);
  assert.match(fillInHtml, /data-math="x \+ 2 y = 4"/);
  assert.match(seriesHtml, /data-math="\\sum_\{n = 1\}\^\{\\infty\} \\frac\{x\^\{n\}\}\{n\}"/);
});

test("renders standalone and inline formulas without touching code spans", () => {
  const displayHtml = renderMarkdown("关键公式：\n\nsqrt(x^2 + 1)");
  const inlineHtml = renderMarkdown("计算 sqrt(x^2) 的值。");
  const codeHtml = renderMarkdown("`sqrt(x^2)`");

  assert.match(displayHtml, /class="math-display"/);
  assert.match(displayHtml, /data-math="\\sqrt\{x\^\{2\} \+ 1\}"/);
  assert.match(inlineHtml, /class="math-inline"/);
  assert.match(inlineHtml, /data-math="\\sqrt\{x\^\{2\}\}"/);
  assert.match(codeHtml, /<code>sqrt\(x\^2\)<\/code>/);
  assert.doesNotMatch(codeHtml, /math-inline/);
});

test("converts Chinese integral bounds and equations used by the platform", () => {
  const source = "设函数 f(x)在区间[a,b]上连续，则有：integral从a到b f(x) dx = F(b) - F(a)，这就是牛顿-莱布尼茨公式。\n\n比如计算 integral从0到1 x dx，f(x)=x 的一个原函数是 F(x)=(1/2)x^2，代入公式得 F(1)-F(0)=(1/2)*1^2-(1/2)*0^2=1/2，所以该定积分的结果是1/2。";
  const html = renderMarkdown(source);

  assert.equal(plainTextToLatex("integral从a到b f(x) dx = F(b) - F(a)"), "\\int_{a}^{b} f\\left(x\\right)\\,\\mathrm{d}x = F\\left(b\\right) - F\\left(a\\right)");
  assert.match(html, /data-math="\\int_\{a\}\^\{b\} f\\left\(x\\right\)\\,\\mathrm\{d\}x = F\\left\(b\\right\) - F\\left\(a\\right\)"/);
  assert.match(html, /data-math="\\int_\{0\}\^\{1\} x\\,\\mathrm\{d\}x"/);
  assert.match(html, /data-math="f\\left\(x\\right\) = x"/);
  assert.match(html, /data-math="F\\left\(x\\right\) = \\left\(\\frac\{1\}\{2\}\\right\) x\^\{2\}"/);
  assert.match(html, /data-math="F\\left\(1\\right\) - F\\left\(0\\right\) = \\left\(\\frac\{1\}\{2\}\\right\)\\cdot 1\^\{2\} - \\left\(\\frac\{1\}\{2\}\\right\)\\cdot 0\^\{2\} = \\frac\{1\}\{2\}"/);
  assert.match(html, /aria-label="公式：1\/2">1\/2<\/span>。<\/p>$/);
});

test("renders pi, compact integral bounds, and evaluation bars in volume formulas", () => {
  const source = [
    "【解析】根据绕x轴旋转的旋转体体积公式 V=pi integral_0^1 [f(x)]^2 dx，代入得：",
    "V=pi integral_0^1 (x^2)^2 dx = πintegral0到1x^4dx = π*(1/5)x^5|0到1 = π/5"
  ].join("\n");
  const html = renderMarkdown(source);

  assert.match(html, /data-math="V = \\pi \\int_\{0\}\^\{1\} \\left\(x\^\{2\}\\right\)\^\{2\}\\,\\mathrm\{d\}x = \\pi \\int_\{0\}\^\{1\} x\^\{4\}\\,\\mathrm\{d\}x = \\pi\\cdot/);
  assert.match(html, /\\Big\|_\{0\}\^\{1\} = \\frac\{\\pi\}\{5\}"/);
  assert.doesNotMatch(html, /data-math="[^"]*integral0到1x/);
});

test("renders native LaTeX delimiters from generated exercises", () => {
  const inlineHtml = renderMarkdown("求极限：$\\lim_{x\\to 0}\\frac{\\sin x}{x}$");
  const displayHtml = renderMarkdown("$$\\int_0^1 x^2 \\, dx$$");
  const multiplicationHtml = renderMarkdown("计算：$\\frac{1}{2}*x^2$");
  const codeHtml = renderMarkdown("`$\\lim_{x\\to 0}$`");

  assert.match(inlineHtml, /class="math-inline" data-math="\\lim_\{x\\to 0\}\\frac\{\\sin x\}\{x\}"/);
  assert.match(displayHtml, /class="math-display" data-math="\\int_0\^1 x\^2 \\, dx"/);
  assert.match(multiplicationHtml, /data-math="\\frac\{1\}\{2\}\\cdot x\^2"/);
  assert.match(codeHtml, /<code>\$\\lim_\{x\\to 0\}\$<\/code>/);
  assert.doesNotMatch(codeHtml, /math-inline/);
});

test("normalizes escaped multiplication without splitting an equation", () => {
  const formula = "F(1)-F(0)=(1/2)\\*1^2-(1/2)\\*0^2=1/2";
  const html = renderMarkdown(`代入公式得${formula}。`);

  assert.equal(plainTextToLatex(formula).replaceAll(" ", ""), "F\\left(1\\right)-F\\left(0\\right)=\\left(\\frac{1}{2}\\right)\\cdot1^{2}-\\left(\\frac{1}{2}\\right)\\cdot0^{2}=\\frac{1}{2}");
  assert.equal((html.match(/class="math-inline"/g) || []).length, 1);
  assert.ok(html.includes("\\cdot 1^{2}"));
  assert.ok(html.includes("\\cdot 0^{2}"));
});

test("renders mixed plain-text formulas used by the learning workflows", () => {
  const source = [
    "lim n->\u65e0\u7a77\u5927 n^2/(n^2+1) = 1",
    "1/x - 1\u5c0f\u4e8e [1/x] \u5c0f\u4e8e\u7b49\u4e8e1/x",
    "lim_{x\u21920+} x\u00b7[1/x]"
  ].join("\n");
  const html = renderMarkdown(source);

  assert.match(html, /\\lim_\{n \\to \\infty\}/);
  assert.match(html, /\\frac\{n\^\{2\}\}\{n\^\{2\} \+ 1\}/);
  assert.match(html, /\\le \\frac\{1\}\{x\}/);
  assert.match(html, /\\lim_\{x \\to 0\^\{\+\}\}/);
});

test("renders infty aliases as the infinity symbol in limits", () => {
  const html = renderMarkdown("lim x->infty (1 + 3/x)^x = _");

  assert.match(html, /data-math="\\lim_\{x \\to \\infty\} \\left\(1 \+ \\frac\{3\}\{x\}\\right\)\^\{x\} = \\underline/);
  assert.doesNotMatch(html, /x \\to infty/);
});

test("keeps multiple-choice labels while rendering formulas in option text", () => {
  const source = [
    "A. (1)/(2)",
    "B、lim x->0 (sin(x))/(x)",
    "（C）sqrt(2)",
    "D) x^2"
  ].join(String.fromCharCode(10));
  const html = renderMarkdown(source);

  assert.equal(html.includes("class=\"math-display\""), false);
  assert.equal(html.split("class=\"math-inline\"").length - 1, 4);
  assert.ok(html.includes("A. "));
  assert.ok(html.includes("B、"));
  assert.ok(html.includes("（C）"));
  assert.ok(html.includes("D) "));
  assert.equal(html.includes("data-math=\"A\""), false);
  assert.equal(html.includes("data-math=\"B\""), false);
});

test("splits same-line multiple-choice options before formula rendering", () => {
  const html = renderMarkdown("A. 0 B. 1/2 C. 1 D. 2");

  assert.equal(html.split("class=\"choice-option\"").length - 1, 4);
  assert.equal(html.split("class=\"math-inline\"").length - 1, 1);
  assert.ok(html.includes("<span class=\"choice-label\">A. </span>0"));
  assert.ok(html.includes("<span class=\"choice-label\">B. </span><span class=\"math-inline\""));
  assert.ok(html.includes("<span class=\"choice-label\">C. </span>1"));
  assert.ok(html.includes("<span class=\"choice-label\">D. </span>2"));
});

test("keeps compact integral bounds intact with a raw LaTex derivative blank", () => {
  const source = "【题目内容】设 y = integral1到x^2 (1/t) dt，则\\frac{dy}{dx} = _";
  const html = renderMarkdown(source);
  const formulas = findInlinePlainTextFormulas(source);

  assert.equal(formulas.some((formula) => formula.raw === "y = integral1"), false);
  assert.match(html, /data-math="\\int_\{1\}\^\{x\^\{2\}\}/);
  assert.match(html, /data-math="\\frac\{dy\}\{dx\} = \\underline\{\\hspace\{2\.6em\}\}"/);
  assert.doesNotMatch(html, /class="math-display"/);
});

test("renders a fill-in blank inside native LaTex delimiters", () => {
  const html = renderMarkdown("结果：$\\frac{dy}{dx} = _$");

  assert.match(html, /data-math="\\frac\{dy\}\{dx\} = \\underline\{\\hspace\{2\.6em\}\}"/);
});
