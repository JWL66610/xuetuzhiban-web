import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.dirname(here);
const demoHtml = fs.readFileSync(path.join(frontendRoot, "embed-demo.html"), "utf8");
const demoScript = fs.readFileSync(path.join(frontendRoot, "embed-demo.js"), "utf8");
const demoStyles = fs.readFileSync(path.join(frontendRoot, "embed-demo.css"), "utf8");

test("WebSDK demo loads the official embed script and host initializer", () => {
  assert.match(demoHtml, /resources\/product\/llm\/public\/sdk\/embedLite\.js/);
  assert.match(demoHtml, /\/embed-demo\.js/);
  assert.match(demoScript, /new window\.HiagentWebSDK\.WebLiteClient/);
  assert.match(demoScript, /variables: \{\}/);
  assert.match(demoScript, /WEB_SDK_BASE_URL = "https:\/\/ai\.yznu\.edu\.cn"/);
});

test("WebSDK demo keeps the client-side configuration free of server API credentials", () => {
  assert.doesNotMatch(demoScript, /HIAGENT_API_KEY|Apikey|SecretKey|AccessKey/);
});

test("WebSDK demo contains mobile overrides for the injected conversation window", () => {
  assert.match(demoStyles, /\.hiagent-conversation/);
  assert.match(demoStyles, /width: auto !important/);
  assert.match(demoStyles, /height: calc\(100dvh - 20px\) !important/);
});
