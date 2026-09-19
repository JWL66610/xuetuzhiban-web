import { renderMarkdown } from "./markdown.js?v=20260908-2030";
import { FILE_ACCEPT, describeAttachments, splitAttachmentMessage, uploadFile, validateAttachments } from "./attachments.js?v=20260910-message-notes";
import { parseSseChunk } from "./sse.js?v=20260910-upload";

const learningQuotes = [
  "每一次认真推导，都会让知识更清晰。",
  "先完成眼前这一题，再看下一题。",
  "理解比记住更重要，慢一点没有关系。",
  "把复杂问题拆成小步，答案会逐渐出现。",
  "稳定的练习，会带来可靠的进步。",
  "今天多弄懂一个知识点，就是有效学习。",
  "遇到困难时，先写下已知条件。",
  "专注当下的几分钟，也是在靠近目标。"
];

const CLIENT_ID_STORAGE_KEY = "xuetuzhiban-client-id";

const state = {
  userId: getOrCreateUserId(),
  clientId: getOrCreateClientId(),
  platformConfig: { apiBaseUrl: "", hasApiKey: false, source: "server" },
  conversationId: null,
  messageId: null,
  abortController: null,
  sending: false,
  attachments: [],
  attachmentMode: "chat",
  targetKnowledgeBase: "",
  contextConversationId: null,
  clock: {
    mode: "clock",
    countdown: { remaining: 25 * 60, endsAt: null },
    stopwatch: { elapsed: 0, startedAt: null },
    focus: { remaining: 25 * 60, endsAt: null }
  },
  conversations: getStoredConversations()
};

const elements = {
  conversation: document.querySelector("#conversation"),
  welcome: document.querySelector("#welcome-panel"),
  composer: document.querySelector("#composer"),
  input: document.querySelector("#message-input"),
  send: document.querySelector("#send-button"),
  stop: document.querySelector("#stop-button"),
  newChat: document.querySelector("#new-chat"),
  template: document.querySelector("#message-template"),
  status: document.querySelector("#connection-status"),
  statusDot: document.querySelector(".status-dot"),
  attachButton: document.querySelector("#attach-button"),
  fileInput: document.querySelector("#file-input"),
  attachmentNote: document.querySelector("#attachment-note"),
  removeAttachment: document.querySelector("#remove-attachment"),
  knowledgeBasePicker: document.querySelector("#knowledge-base-picker"),
  knowledgeBaseSelect: document.querySelector("#knowledge-base-select"),
  conversationNav: document.querySelector("#conversation-nav"),
  conversationEmpty: document.querySelector("#conversation-empty"),
  conversationContextMenu: document.querySelector("#conversation-context-menu"),
  recentLearningList: document.querySelector("#recent-learning-list"),
  recentLearningEmpty: document.querySelector("#recent-learning-empty"),
  studyClockTrigger: document.querySelector("#study-clock-trigger"),
  studyClockTopTime: document.querySelector("#study-clock-top-time"),
  studyClockModal: document.querySelector("#study-clock-modal"),
  clockCloseButton: document.querySelector("#clock-close-button"),
  clockCurrentTime: document.querySelector("#clock-current-time"),
  clockCurrentDate: document.querySelector("#clock-current-date"),
  countdownDisplay: document.querySelector("#countdown-display"),
  countdownHours: document.querySelector("#countdown-hours"),
  countdownMinutes: document.querySelector("#countdown-minutes"),
  countdownSeconds: document.querySelector("#countdown-seconds"),
  countdownToggle: document.querySelector("#countdown-toggle"),
  countdownReset: document.querySelector("#countdown-reset"),
  stopwatchDisplay: document.querySelector("#stopwatch-display"),
  stopwatchToggle: document.querySelector("#stopwatch-toggle"),
  stopwatchReset: document.querySelector("#stopwatch-reset"),
  focusDisplay: document.querySelector("#focus-display"),
  focusMinutes: document.querySelector("#focus-minutes"),
  focusToggle: document.querySelector("#focus-toggle"),
  focusReset: document.querySelector("#focus-reset"),
  sidebar: document.querySelector(".sidebar"),
  mobileNavToggle: document.querySelector("#mobile-nav-toggle"),
  mobileNavBackdrop: document.querySelector("#mobile-nav-backdrop"),
  apiSettingsTrigger: document.querySelector("#api-settings-trigger"),
  apiConfigBadge: document.querySelector("#api-config-badge"),
  apiSettingsModal: document.querySelector("#api-settings-modal"),
  apiSettingsForm: document.querySelector("#api-settings-form"),
  apiSettingsClose: document.querySelector("#api-settings-close"),
  apiSettingsCancel: document.querySelector("#api-settings-cancel"),
  apiSettingsReset: document.querySelector("#api-settings-reset"),
  apiSettingsSave: document.querySelector("#api-settings-save"),
  apiBaseUrl: document.querySelector("#api-base-url"),
  apiKey: document.querySelector("#api-key"),
  apiKeyToggle: document.querySelector("#api-key-toggle"),
  apiSettingsSource: document.querySelector("#api-settings-source"),
  apiSettingsFeedback: document.querySelector("#api-settings-feedback")
};

function getStoredConversations() {
  try {
    const stored = JSON.parse(window.localStorage.getItem("xuetuzhiban-conversations") || "[]");
    return Array.isArray(stored)
      ? stored
        .filter((item) => item && typeof item.id === "string" && typeof item.title === "string")
        .map((item) => ({
          ...item,
          messages: Array.isArray(item.messages)
            ? item.messages.filter((message) =>
              message
              && (message.role === "user" || message.role === "assistant")
              && typeof message.text === "string"
            )
            : []
        }))
      : [];
  } catch {
    return [];
  }
}

function getConversationTitle() {
  const now = new Date();
  const baseTitle = `${now.getMonth() + 1}月${now.getDate()}日学习对话`;
  const sameDayCount = state.conversations.filter((item) => item.title.startsWith(baseTitle)).length;
  return sameDayCount ? `${baseTitle} ${sameDayCount + 1}` : baseTitle;
}

function persistConversations() {
  window.localStorage.setItem("xuetuzhiban-conversations", JSON.stringify(state.conversations));
}

function renderConversationNav() {
  elements.conversationNav.querySelectorAll(".conversation-item-wrap").forEach((item) => item.remove());
  elements.conversationEmpty.hidden = state.conversations.length > 0;

  state.conversations.forEach((conversation) => {
    const row = document.createElement("div");
    const button = document.createElement("button");
    const moreButton = document.createElement("button");
    row.className = "conversation-item-wrap";
    button.type = "button";
    button.className = "conversation-item";
    button.textContent = conversation.title;
    button.title = conversation.title;
    button.classList.toggle("active", conversation.id === state.conversationId);
    button.classList.toggle("marked", Boolean(conversation.marked));
    button.addEventListener("click", () => selectConversation(conversation));
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openConversationContextMenu(conversation, event.clientX, event.clientY);
    });
    moreButton.type = "button";
    moreButton.className = "conversation-more";
    moreButton.title = "更多操作";
    moreButton.setAttribute("aria-label", "打开 " + conversation.title + " 的更多操作");
    moreButton.innerHTML = '<i data-lucide="ellipsis" aria-hidden="true"></i>';
    moreButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const rect = moreButton.getBoundingClientRect();
      openConversationContextMenu(conversation, rect.right, rect.bottom);
    });
    row.append(button, moreButton);
    elements.conversationNav.append(row);
  });

  if (window.lucide) window.lucide.createIcons();
  renderRecentLearning();
}

function closeConversationContextMenu() {
  state.contextConversationId = null;
  elements.conversationContextMenu.hidden = true;
}

function openConversationContextMenu(conversation, clientX, clientY) {
  state.contextConversationId = conversation.id;
  const markLabel = elements.conversationContextMenu.querySelector('[data-conversation-action="mark"] span');
  markLabel.textContent = conversation.marked ? "取消标记" : "标记对话";
  elements.conversationContextMenu.hidden = false;

  const menuWidth = elements.conversationContextMenu.offsetWidth;
  const menuHeight = elements.conversationContextMenu.offsetHeight;
  const left = Math.min(clientX, window.innerWidth - menuWidth - 8);
  const top = Math.min(clientY, window.innerHeight - menuHeight - 8);
  elements.conversationContextMenu.style.left = `${Math.max(8, left)}px`;
  elements.conversationContextMenu.style.top = `${Math.max(8, top)}px`;
}

function resetToNewConversation() {
  state.conversationId = null;
  state.messageId = null;
  window.sessionStorage.removeItem("xuetuzhiban-conversation");
  elements.conversation.replaceChildren(elements.welcome || createWelcomeFallback());
}

function handleConversationContextAction(action) {
  const conversation = getConversation(state.contextConversationId);
  closeConversationContextMenu();
  if (!conversation || state.sending) return;

  if (action === "mark") {
    conversation.marked = !conversation.marked;
    persistConversations();
    renderConversationNav();
    return;
  }

  if (action !== "delete") return;
  const confirmed = window.confirm(`确定删除“${conversation.title}”吗？此操作只会删除本浏览器保存的对话记录。`);
  if (!confirmed) return;

  const currentConversationDeleted = state.conversationId === conversation.id;
  state.conversations = state.conversations.filter((item) => item.id !== conversation.id);
  persistConversations();
  if (currentConversationDeleted) resetToNewConversation();
  renderConversationNav();
  elements.input.focus();
}

function renderRecentLearning() {
  elements.recentLearningList.querySelectorAll(".recent-item").forEach((item) => item.remove());
  elements.recentLearningEmpty.hidden = state.conversations.length > 0;

  state.conversations.slice(0, 3).forEach((conversation) => {
    const button = document.createElement("button");
    const label = document.createElement("span");
    const title = document.createElement("strong");
    button.type = "button";
    button.className = "recent-item";
    label.textContent = conversation.id === state.conversationId ? "当前对话" : "继续学习";
    title.textContent = conversation.title;
    button.append(label, title);
    button.addEventListener("click", () => selectConversation(conversation));
    elements.recentLearningList.append(button);
  });
}

function registerConversation(conversationId, title) {
  if (state.conversations.some((item) => item.id === conversationId)) return;
  state.conversations.unshift({ id: conversationId, title, messages: [] });
  persistConversations();
  renderConversationNav();
}

function getConversation(conversationId) {
  return state.conversations.find((item) => item.id === conversationId);
}

function storeConversationMessage(conversationId, role, text) {
  const conversation = getConversation(conversationId);
  const content = String(text || "").trim();
  if (!conversation || !content) return;

  conversation.messages ||= [];
  const lastMessage = conversation.messages.at(-1);
  if (lastMessage?.role === role && lastMessage.text === content) return;

  conversation.messages.push({ role, text: content });
  persistConversations();
}

function appendStoredMessage(message) {
  const rendered = createMessage(message.role, message.text);
  if (message.role === "assistant") {
    rendered.body.classList.remove("typing");
    setMarkdown(rendered.body, message.text);
  }
}

function renderConversationMessages(messages) {
  elements.conversation.replaceChildren();
  messages.forEach(appendStoredMessage);
  scrollToLatestAfterRender();
}

function readHistoryField(message, names) {
  for (const name of names) {
    const value = message?.[name];
    const text = readHistoryText(value);
    if (text) return text;
  }
  return "";
}

function readHistoryText(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map(readHistoryText).filter(Boolean).join("\n").trim();
  }
  if (!value || typeof value !== "object") return "";

  return readHistoryField(value, [
    "Text", "text", "Content", "content", "Answer", "answer",
    "Output", "output", "Message", "message", "Value", "value"
  ]);
}

function findHistoryText(value, pattern, depth = 0) {
  if (!value || typeof value !== "object" || depth > 5) return "";

  for (const [key, item] of Object.entries(value)) {
    if (pattern.test(key)) {
      const text = readHistoryText(item);
      if (text) return text;
    }

    const nestedText = findHistoryText(item, pattern, depth + 1);
    if (nestedText) return nestedText;
  }
  return "";
}

function normalizeHistoryMessages(messages) {
  const normalized = [];

  messages.slice().reverse().forEach((message) => {
    if (!message || typeof message !== "object") return;

    const query = readHistoryField(message, [
      "Query", "query", "UserQuery", "user_query", "Question", "question",
      "Input", "input", "Prompt", "prompt", "UserMessage", "user_message"
    ]) || findHistoryText(message, /^(query|question|prompt|input|user.*message)$/i);
    const answer = readHistoryField(message, [
      "Answer", "answer", "Response", "response", "Reply", "reply",
      "Output", "output", "BotMessage", "bot_message", "AssistantMessage", "assistant_message",
      "AssistantAnswer", "assistant_answer"
    ]) || findHistoryText(message, /^(answer|response|reply|output|bot.*message|assistant.*message)$/i);

    if (query) normalized.push({ role: "user", text: query });
    if (answer) normalized.push({ role: "assistant", text: answer });
    if (query || answer) return;

    const content = readHistoryField(message, ["Message", "message", "Text", "text", "Content", "content"]);
    const role = String(
      message.Role || message.role || message.MessageRole || message.message_role
      || message.SenderRole || message.sender_role || message.SenderType || message.sender_type
      || message.MessageType || message.message_type || message.Type || message.type || ""
    ).toLowerCase();
    if (content && ["user", "human", "question", "query", "1"].includes(role)) normalized.push({ role: "user", text: content });
    if (content && ["assistant", "bot", "ai", "answer", "reply", "2"].includes(role)) normalized.push({ role: "assistant", text: content });
  });

  return normalized;
}

async function restoreConversation(conversation) {
  const cachedMessages = conversation.messages || [];
  if (cachedMessages.length) renderConversationMessages(cachedMessages);
  else elements.conversation.replaceChildren(createConversationNotice("正在载入历史消息…"));

  try {
    const data = await requestJson("/api/history", {
      userId: state.userId,
      conversationId: conversation.id,
      limit: 100
    });
    if (state.conversationId !== conversation.id) return;

    const messages = normalizeHistoryMessages(Array.isArray(data.messages) ? data.messages : []);
    const hasAssistantReply = messages.some((message) => message.role === "assistant");
    if (hasAssistantReply || !cachedMessages.length) conversation.messages = messages;
    persistConversations();

    if (conversation.messages.length) {
      renderConversationMessages(conversation.messages);
    } else {
      elements.conversation.replaceChildren(createConversationNotice("该学习对话暂时没有可显示的历史消息。"));
    }
  } catch (error) {
    if (state.conversationId !== conversation.id) return;
    if (cachedMessages.length) {
      renderConversationMessages(cachedMessages);
    } else {
      elements.conversation.replaceChildren(
        createConversationNotice(`历史消息加载失败：${error.message}`)
      );
    }
  }
}

function selectConversation(conversation) {
  if (state.sending || conversation.id === state.conversationId) return;
  closeMobileSidebar();
  state.conversationId = conversation.id;
  state.messageId = null;
  window.sessionStorage.setItem("xuetuzhiban-conversation", state.conversationId);
  renderConversationNav();
  restoreConversation(conversation);
  elements.input.focus();
}

function createConversationNotice(title) {
  const panel = document.createElement("div");
  const heading = document.createElement("strong");
  const detail = document.createElement("span");
  panel.className = "conversation-notice";
  heading.textContent = title;
  detail.textContent = "已切换到该学习对话，可继续提问。";
  panel.append(heading, detail);
  return panel;
}

function getOrCreateUserId() {
  const stored = window.localStorage.getItem("xuetuzhiban-user-id");
  if (stored) return stored;
  const id = `u${crypto.randomUUID().replaceAll("-", "").slice(0, 19)}`;
  window.localStorage.setItem("xuetuzhiban-user-id", id);
  return id;
}

function getOrCreateClientId() {
  const stored = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (stored) return stored;
  const id = `c${crypto.randomUUID().replaceAll("-", "")}`;
  window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, id);
  return id;
}

function getClientHeaders(extraHeaders = {}) {
  return {
    "X-Xuetuzhiban-Client-Id": state.clientId,
    ...extraHeaders
  };
}

function scrollToLatest() {
  elements.conversation.scrollTop = elements.conversation.scrollHeight;
}

function scrollToLatestAfterRender() {
  window.requestAnimationFrame(() => {
    scrollToLatest();
    window.setTimeout(scrollToLatest, 0);
  });
}

function autoResize() {
  elements.input.style.height = "auto";
  const height = Math.min(elements.input.scrollHeight, 150);
  elements.input.style.height = `${height}px`;
  elements.input.style.overflowY = elements.input.scrollHeight > 150 ? "auto" : "hidden";
}

function clampClockNumber(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number.parseInt(value, 10) || 0));
}

function formatClockDuration(totalSeconds, alwaysShowHours = false) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return alwaysShowHours || hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(remainder)}`
    : `${pad(minutes)}:${pad(remainder)}`;
}

function getCountdownInputSeconds() {
  const hours = clampClockNumber(elements.countdownHours.value, 0, 23);
  const minutes = clampClockNumber(elements.countdownMinutes.value, 0, 59);
  const seconds = clampClockNumber(elements.countdownSeconds.value, 0, 59);
  elements.countdownHours.value = hours;
  elements.countdownMinutes.value = minutes;
  elements.countdownSeconds.value = seconds;
  return hours * 3600 + minutes * 60 + seconds;
}

function getTimerRemaining(timer, now = Date.now()) {
  if (!timer.endsAt) return timer.remaining;
  timer.remaining = Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
  if (timer.remaining === 0) timer.endsAt = null;
  return timer.remaining;
}

function setClockMode(mode) {
  state.clock.mode = mode;
  document.querySelectorAll("[data-clock-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.clockPanel !== mode;
  });
  document.querySelectorAll("[data-clock-mode]").forEach((tab) => {
    const active = tab.dataset.clockMode === mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  refreshStudyClock();
}

function refreshStudyClock() {
  const now = new Date();
  elements.studyClockTopTime.textContent = now.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  elements.clockCurrentTime.textContent = now.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  elements.clockCurrentDate.textContent = now.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  });

  const countdownRemaining = getTimerRemaining(state.clock.countdown);
  elements.countdownDisplay.textContent = formatClockDuration(countdownRemaining);
  elements.countdownToggle.textContent = state.clock.countdown.endsAt ? "暂停" : "开始";

  const stopwatch = state.clock.stopwatch;
  const stopwatchElapsed = stopwatch.elapsed + (stopwatch.startedAt ? Date.now() - stopwatch.startedAt : 0);
  elements.stopwatchDisplay.textContent = formatClockDuration(Math.floor(stopwatchElapsed / 1000), true);
  elements.stopwatchToggle.textContent = stopwatch.startedAt ? "暂停" : "开始";

  const focusRemaining = getTimerRemaining(state.clock.focus);
  elements.focusDisplay.textContent = formatClockDuration(focusRemaining);
  elements.focusToggle.textContent = state.clock.focus.endsAt ? "暂停自习" : "开始自习";
}

function openStudyClock() {
  elements.studyClockModal.hidden = false;
  elements.studyClockTrigger.setAttribute("aria-expanded", "true");
  refreshStudyClock();
  elements.clockCloseButton.focus();
}

function closeStudyClock() {
  elements.studyClockModal.hidden = true;
  elements.studyClockTrigger.setAttribute("aria-expanded", "false");
  elements.studyClockTrigger.focus();
}

function closeMobileSidebar() {
  elements.sidebar.classList.remove("mobile-open");
  elements.mobileNavBackdrop.hidden = true;
  elements.mobileNavToggle.setAttribute("aria-expanded", "false");
  elements.mobileNavToggle.setAttribute("aria-label", "打开导航");
  elements.mobileNavToggle.title = "打开导航";
}

function toggleMobileSidebar() {
  const isOpen = !elements.sidebar.classList.contains("mobile-open");
  elements.sidebar.classList.toggle("mobile-open", isOpen);
  elements.mobileNavBackdrop.hidden = !isOpen;
  elements.mobileNavToggle.setAttribute("aria-expanded", String(isOpen));
  elements.mobileNavToggle.setAttribute("aria-label", isOpen ? "关闭导航" : "打开导航");
  elements.mobileNavToggle.title = isOpen ? "关闭导航" : "打开导航";
}

function toggleCountdown() {
  const timer = state.clock.countdown;
  if (timer.endsAt) {
    getTimerRemaining(timer);
    timer.endsAt = null;
  } else {
    if (!timer.remaining) timer.remaining = getCountdownInputSeconds();
    if (timer.remaining) timer.endsAt = Date.now() + timer.remaining * 1000;
  }
  refreshStudyClock();
}

function resetCountdown() {
  state.clock.countdown.remaining = getCountdownInputSeconds();
  state.clock.countdown.endsAt = null;
  refreshStudyClock();
}

function toggleStopwatch() {
  const stopwatch = state.clock.stopwatch;
  if (stopwatch.startedAt) {
    stopwatch.elapsed += Date.now() - stopwatch.startedAt;
    stopwatch.startedAt = null;
  } else {
    stopwatch.startedAt = Date.now();
  }
  refreshStudyClock();
}

function resetStopwatch() {
  state.clock.stopwatch.elapsed = 0;
  state.clock.stopwatch.startedAt = null;
  refreshStudyClock();
}

function resetFocus() {
  state.clock.focus.remaining = Number(elements.focusMinutes.value) * 60;
  state.clock.focus.endsAt = null;
  refreshStudyClock();
}

function toggleFocus() {
  const timer = state.clock.focus;
  if (timer.endsAt) {
    getTimerRemaining(timer);
    timer.endsAt = null;
  } else {
    if (!timer.remaining) timer.remaining = Number(elements.focusMinutes.value) * 60;
    timer.endsAt = Date.now() + timer.remaining * 1000;
  }
  refreshStudyClock();
}

function setSending(sending) {
  state.sending = sending;
  elements.send.disabled = sending;
  elements.newChat.disabled = sending;
  elements.stop.hidden = !sending;
  elements.attachButton.disabled = sending;
  elements.knowledgeBaseSelect.disabled = sending;
  elements.removeAttachment.disabled = sending;
  elements.fileInput.disabled = sending;
  elements.apiSettingsTrigger.disabled = sending;
  document.querySelectorAll("[data-upload], .feature-item").forEach((button) => { button.disabled = sending; });
  elements.composer.setAttribute("aria-busy", String(sending));
}

function setPlainText(body, text) {
  body.classList.remove("markdown");
  body.classList.add("plain-text");
  body.textContent = text;
}

function setUserMessage(body, text) {
  const message = splitAttachmentMessage(text);
  body.classList.add("user-message");
  body.replaceChildren();
  if (message.text) {
    const content = document.createElement("div");
    content.className = "message-user-text";
    content.textContent = message.text;
    body.append(content);
  }
  for (const note of message.notes) {
    const element = document.createElement("div");
    element.className = "message-system-note";
    element.textContent = note;
    body.append(element);
  }
}

function renderMath(body) {
  if (!window.katex?.render) return;

  body.querySelectorAll("[data-math]").forEach((element) => {
    if (element.dataset.mathRendered === "true") return;
    const source = element.dataset.math || "";
    const fallback = element.textContent;
    try {
      window.katex.render(source, element, {
        displayMode: element.classList.contains("math-display"),
        throwOnError: true,
        trust: false,
        strict: "ignore",
        output: "htmlAndMathml"
      });
      element.dataset.mathRendered = "true";
    } catch {
      element.textContent = fallback;
      element.classList.add("math-fallback");
      element.dataset.mathRendered = "true";
    }
  });
}

function setMarkdown(body, text) {
  body.classList.remove("plain-text");
  body.classList.add("markdown");
  body.innerHTML = renderMarkdown(text);
  renderMath(body);
}

function createMessage(role, text = "") {
  const fragment = elements.template.content.cloneNode(true);
  const message = fragment.querySelector(".message");
  const body = fragment.querySelector(".message-body");
  const meta = fragment.querySelector(".message-meta");
  const actions = fragment.querySelector(".message-actions");

  message.classList.add(role);
  meta.textContent = role === "assistant" ? "学途智伴" : "你";
  if (role === "user") setUserMessage(body, text);
  else setPlainText(body, text);
  if (role === "assistant") body.classList.add("typing");
  if (role === "assistant") actions.hidden = true;
  elements.conversation.append(fragment);
  elements.welcome?.remove();
  scrollToLatest();
  return {
    message: elements.conversation.lastElementChild,
    body: elements.conversation.lastElementChild.querySelector(".message-body"),
    actions: elements.conversation.lastElementChild.querySelector(".message-actions")
  };
}

function applyApiConfig(data) {
  state.platformConfig = {
    apiBaseUrl: typeof data?.apiBaseUrl === "string" ? data.apiBaseUrl : "",
    hasApiKey: Boolean(data?.hasApiKey),
    source: data?.source === "browser" ? "browser" : "server"
  };
  renderApiConfigIndicator();
}

function renderApiConfigIndicator() {
  if (!elements.apiConfigBadge) return;
  const hasKey = Boolean(state.platformConfig.hasApiKey);
  const configured = Boolean(state.platformConfig.apiBaseUrl && hasKey);
  elements.apiConfigBadge.textContent = configured
    ? (state.platformConfig.source === "browser" ? "本机" : "服务端")
    : "未配置";
  elements.apiConfigBadge.classList.toggle("configured", configured);
  elements.apiConfigBadge.classList.toggle("custom", configured && state.platformConfig.source === "browser");
}

async function readApiConfig() {
  const response = await fetch("/api/config", {
    headers: getClientHeaders(),
    cache: "no-store"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "无法读取 API 配置");
  return data;
}

async function initializeApiConfig() {
  try {
    applyApiConfig(await readApiConfig());
  } catch {
    renderApiConfigIndicator();
  }
}

function setApiSettingsFeedback(message, type = "") {
  elements.apiSettingsFeedback.textContent = message;
  elements.apiSettingsFeedback.dataset.type = type;
}

function updateApiSettingsSource() {
  const source = state.platformConfig.source === "browser" ? "本机配置" : "服务端默认配置";
  const hasKey = Boolean(state.platformConfig.hasApiKey);
  elements.apiSettingsSource.textContent = state.platformConfig.apiBaseUrl
    ? `当前来源：${source}${hasKey ? " · 已配置密钥" : " · 尚未配置密钥"}`
    : "当前尚未配置可用的 API。";
}

function openApiSettings() {
  elements.apiSettingsModal.hidden = false;
  elements.apiSettingsTrigger.setAttribute("aria-expanded", "true");
  elements.apiBaseUrl.value = state.platformConfig.apiBaseUrl || "";
  elements.apiKey.value = "";
  elements.apiKey.placeholder = state.platformConfig.hasApiKey
    ? "已配置密钥，留空保持不变"
    : "请输入平台生成的 API 密钥";
  elements.apiKey.type = "password";
  elements.apiKeyToggle.setAttribute("aria-pressed", "false");
  elements.apiKeyToggle.setAttribute("aria-label", "显示密钥");
  elements.apiKeyToggle.title = "显示密钥";
  elements.apiKeyToggle.innerHTML = '<i data-lucide="eye" aria-hidden="true"></i>';
  updateApiSettingsSource();
  setApiSettingsFeedback("");
  if (window.lucide) window.lucide.createIcons();
  elements.apiBaseUrl.focus();
}

function closeApiSettings() {
  elements.apiSettingsModal.hidden = true;
  elements.apiSettingsTrigger.setAttribute("aria-expanded", "false");
  elements.apiSettingsTrigger.focus();
}

function setApiSettingsBusy(busy) {
  elements.apiSettingsSave.disabled = busy;
  elements.apiSettingsReset.disabled = busy;
  elements.apiSettingsCancel.disabled = busy;
  elements.apiSettingsClose.disabled = busy;
  elements.apiBaseUrl.disabled = busy;
  elements.apiKey.disabled = busy;
  elements.apiKeyToggle.disabled = busy;
}

async function saveApiSettings(event) {
  event.preventDefault();
  const apiBaseUrl = elements.apiBaseUrl.value.trim().replace(/\/+$/, "");
  const apiKey = elements.apiKey.value.trim();

  if (!apiBaseUrl) {
    setApiSettingsFeedback("请输入 API 地址。", "error");
    elements.apiBaseUrl.focus();
    return;
  }
  try {
    const parsed = new URL(apiBaseUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error();
    }
  } catch {
    setApiSettingsFeedback("API 地址应为不带查询参数的 http 或 https 地址。", "error");
    elements.apiBaseUrl.focus();
    return;
  }
  const keepsCurrentBrowserKey = !apiKey
    && state.platformConfig.source === "browser"
    && state.platformConfig.apiBaseUrl === apiBaseUrl
    && state.platformConfig.hasApiKey;
  const keepsServerConfig = !apiKey
    && state.platformConfig.source === "server"
    && state.platformConfig.apiBaseUrl === apiBaseUrl
    && state.platformConfig.hasApiKey;
  if (!apiKey && !keepsCurrentBrowserKey && !keepsServerConfig) {
    setApiSettingsFeedback("自定义 API 地址需要填写对应的 API 密钥；如需恢复服务端配置，请点击“恢复服务端配置”。", "error");
    elements.apiKey.focus();
    return;
  }

  setApiSettingsBusy(true);
  setApiSettingsFeedback("正在保存配置…");
  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: getClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ clientId: state.clientId, apiBaseUrl, apiKey })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "保存 API 配置失败");

    applyApiConfig(data);
    elements.apiKey.value = "";
    elements.apiKey.placeholder = "已配置密钥，留空保持不变";
    updateApiSettingsSource();
    setApiSettingsFeedback("配置已保存，新的请求将使用这组 API。", "success");
    await checkHealth();
  } catch (error) {
    setApiSettingsFeedback(error.message, "error");
  } finally {
    setApiSettingsBusy(false);
  }
}

async function resetApiSettings() {
  setApiSettingsBusy(true);
  setApiSettingsFeedback("正在恢复服务端配置…");
  try {
    const response = await fetch("/api/config", {
      method: "DELETE",
      headers: getClientHeaders()
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "恢复服务端配置失败");
    applyApiConfig(data);
    elements.apiBaseUrl.value = data.apiBaseUrl || "";
    elements.apiKey.value = "";
    updateApiSettingsSource();
    setApiSettingsFeedback("已恢复服务端默认配置。", "success");
    await checkHealth();
  } catch (error) {
    setApiSettingsFeedback(error.message, "error");
  } finally {
    setApiSettingsBusy(false);
  }
}

async function requestJson(url, payload, signal) {
  const response = await fetch(url, {
    method: "POST",
    headers: getClientHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
    signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

async function ensureConversation(signal) {
  if (state.conversationId) return state.conversationId;
  const conversationTitle = getConversationTitle();
  const data = await requestJson("/api/conversations", {
    userId: state.userId,
    conversationName: conversationTitle
  }, signal);
  state.conversationId = data.conversationId;
  window.sessionStorage.setItem("xuetuzhiban-conversation", state.conversationId);
  registerConversation(state.conversationId, conversationTitle);
  return state.conversationId;
}

function setWaitingQuote(body, quote) {
  setPlainText(body, quote);
  const loadingDots = document.createElement("span");
  loadingDots.className = "loading-dots";
  loadingDots.setAttribute("aria-label", "正在等待回复");
  for (let index = 0; index < 3; index += 1) {
    loadingDots.append(document.createElement("span"));
  }
  body.append(loadingDots);
}

function startLearningQuoteRotation(body) {
  let quoteIndex = Math.floor(Math.random() * learningQuotes.length);
  body.classList.add("waiting-quote");
  const showQuote = () => {
    setWaitingQuote(body, "学习片刻：" + learningQuotes[quoteIndex]);
    quoteIndex = (quoteIndex + 1 + Math.floor(Math.random() * (learningQuotes.length - 1))) % learningQuotes.length;
    scrollToLatest();
  };

  showQuote();
  const rotationId = window.setInterval(showQuote, 3600);
  return () => {
    window.clearInterval(rotationId);
    body.classList.remove("waiting-quote");
  };
}

async function streamChat(query, assistantMessage, files = [], onAnswerStart = () => {}) {
  const signal = state.abortController.signal;
  signal.throwIfAborted();
  const conversationId = await ensureConversation(signal);
  signal.throwIfAborted();
  storeConversationMessage(conversationId, "user", describeAttachments(query, files));
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: getClientHeaders({ "Content-Type": "application/json", Accept: "text/event-stream" }),
    body: JSON.stringify({ userId: state.userId, conversationId, query, files }),
    signal
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "无法连接到智能体服务");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let answer = "";
  let messageId = null;

  const handleEvent = (event) => {
    if (event.task_id) state.messageId = event.task_id;
    if (event.id) messageId = event.id;
    if (event.event === "message" && typeof event.answer === "string") {
      onAnswerStart();
      answer += event.answer;
      setMarkdown(assistantMessage.body, answer);
      scrollToLatest();
    }
    if (event.event === "message_replace" && typeof event.answer === "string") {
      onAnswerStart();
      answer = event.answer;
      setMarkdown(assistantMessage.body, answer);
    }
    if (event.event === "message_failed") {
      throw new Error(event.message || "智能体执行失败");
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunk(buffer, handleEvent);
    }
    buffer += decoder.decode();
    if (buffer.trim()) parseSseChunk(`${buffer}\n\n`, handleEvent);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }

  assistantMessage.body.classList.remove("typing");
  if (!answer) {
    throw new Error("本次未收到可展示的回复，请重试。");
  } else {
    storeConversationMessage(conversationId, "assistant", answer);
  }
  const finalMessageId = messageId || state.messageId;
  if (finalMessageId) enableFeedback(assistantMessage.actions, finalMessageId);
}

function enableFeedback(actions, messageId) {
  actions.hidden = false;
  actions.querySelectorAll(".feedback-button").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await requestJson("/api/feedback", {
          userId: state.userId,
          messageId,
          likeType: Number(button.dataset.like)
        });
        actions.querySelectorAll(".feedback-button").forEach((item) => item.classList.remove("selected"));
        button.classList.add("selected");
      } catch (error) {
        window.alert(error.message);
      }
    });
  });
}

async function uploadAttachments(assistantMessage) {
  const uploadedFiles = [];
  for (const file of state.attachments) {
    state.abortController.signal.throwIfAborted();
    const progress = `正在上传 ${uploadedFiles.length + 1}/${state.attachments.length}：${file.name}`;
    setPlainText(assistantMessage.body, progress);
    showAttachments(progress);
    uploadedFiles.push(await uploadFile(file, {
      signal: state.abortController.signal,
      headers: getClientHeaders()
    }));
  }
  return uploadedFiles;
}

function showAttachments(status = "") {
  if (!state.attachments.length) {
    elements.attachmentNote.hidden = true;
    elements.knowledgeBasePicker.hidden = true;
    return;
  }
  const names = state.attachments.map((file) => file.name).join("、");
  elements.attachmentNote.hidden = false;
  elements.knowledgeBasePicker.hidden = state.attachmentMode !== "knowledge-upload";
  const label = elements.attachmentNote.querySelector("span");
  label.textContent = status || `已选择 ${state.attachments.length} 个附件：${names}`;
  label.title = names;
}

function buildUploadQuery(inputQuery, targetKnowledgeBase) {
  const baseQuery = inputQuery || `请将我上传的资料写入“${targetKnowledgeBase}”知识库。`;
  return `${baseQuery}\n\n【资料入库目标】${targetKnowledgeBase}\n请将本次上传的文件写入“${targetKnowledgeBase}”知识库；若文件无法处理，请明确说明原因。`;
}

async function sendMessage(rawQuery) {
  const inputQuery = String(rawQuery || elements.input.value).trim();
  if ((!inputQuery && !state.attachments.length) || state.sending) return;
  try {
    validateAttachments(state.attachments, state.attachmentMode);
  } catch (error) {
    window.alert(error.message);
    return;
  }

  if (state.attachmentMode === "knowledge-upload" && state.attachments.length && !state.targetKnowledgeBase) {
    const assistantMessage = createMessage("assistant", "");
    setPlainText(assistantMessage.body, "请先选择资料要写入的知识库，再提交上传。其他课程或个人资料请选择“个人知识库”。");
    assistantMessage.body.classList.remove("typing");
    elements.knowledgeBaseSelect.focus();
    return;
  }

  const query = state.attachmentMode === "knowledge-upload" && state.attachments.length
    ? buildUploadQuery(inputQuery, state.targetKnowledgeBase)
    : inputQuery || "请查看我上传的附件，并概括主要内容。";

  createMessage("user", describeAttachments(query, state.attachments));
  elements.input.value = "";
  autoResize();
  setSending(true);
  state.messageId = null;
  state.abortController = new AbortController();
  const assistantMessage = createMessage("assistant", "");
  let stopLearningQuotes = () => {};
  try {
    if (state.attachments.length) {
      setPlainText(assistantMessage.body, "正在上传附件…");
    }
    const files = await uploadAttachments(assistantMessage);
    state.abortController.signal.throwIfAborted();
    if (files.length) setPlainText(assistantMessage.body, "附件已上传，正在生成回答…");
    if (files.length) showAttachments(`已上传 ${files.length} 个附件，正在处理…`);
    stopLearningQuotes = startLearningQuoteRotation(assistantMessage.body);
    await streamChat(query, assistantMessage, files, stopLearningQuotes);
    state.attachments = [];
    state.attachmentMode = "chat";
    state.targetKnowledgeBase = "";
    elements.fileInput.value = "";
    elements.knowledgeBaseSelect.value = "";
    showAttachments();
  } catch (error) {
    stopLearningQuotes();
    assistantMessage.body.classList.remove("typing");
    const cancelled = state.abortController?.signal.aborted;
    setPlainText(assistantMessage.body, cancelled ? "已取消本次请求。附件和输入已保留。" : "请求未完成：" + error.message);
    if (!elements.input.value) elements.input.value = inputQuery;
    autoResize();
  } finally {
    stopLearningQuotes();
    state.abortController = null;
    setSending(false);
    showAttachments();
    elements.input.focus();
  }
}

async function stopGeneration() {
  state.abortController?.abort();
  if (state.messageId) {
    try {
      await requestJson("/api/stop", { userId: state.userId, messageId: state.messageId });
    } catch {
      // Aborting the browser stream is still useful when the platform stop request fails.
    }
  }
}

async function checkHealth() {
  try {
    const response = await fetch("/health", { headers: getClientHeaders(), cache: "no-store" });
    const data = await response.json();
    if (data.configured) {
      elements.status.textContent = "服务已就绪";
      elements.statusDot.classList.add("online");
    } else {
      elements.status.textContent = "等待 API 配置";
      elements.statusDot.classList.add("offline");
    }
    applyApiConfig(data);
    updateApiSettingsSource();
  } catch {
    elements.status.textContent = "服务未连接";
    elements.statusDot.classList.add("offline");
    renderApiConfigIndicator();
  }
}

elements.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage();
});

elements.input.addEventListener("input", autoResize);
elements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

elements.stop.addEventListener("click", stopGeneration);
elements.apiSettingsTrigger.addEventListener("click", openApiSettings);
elements.apiSettingsForm.addEventListener("submit", saveApiSettings);
elements.apiSettingsClose.addEventListener("click", closeApiSettings);
elements.apiSettingsCancel.addEventListener("click", closeApiSettings);
elements.apiSettingsReset.addEventListener("click", resetApiSettings);
elements.apiSettingsModal.addEventListener("click", (event) => {
  if (event.target === elements.apiSettingsModal) closeApiSettings();
});
elements.apiKeyToggle.addEventListener("click", () => {
  const visible = elements.apiKey.type === "text";
  elements.apiKey.type = visible ? "password" : "text";
  elements.apiKeyToggle.setAttribute("aria-pressed", String(!visible));
  elements.apiKeyToggle.setAttribute("aria-label", visible ? "显示密钥" : "隐藏密钥");
  elements.apiKeyToggle.title = visible ? "显示密钥" : "隐藏密钥";
  elements.apiKeyToggle.innerHTML = `<i data-lucide="${visible ? "eye" : "eye-off"}" aria-hidden="true"></i>`;
  if (window.lucide) window.lucide.createIcons();
});
elements.newChat.addEventListener("click", () => {
  if (state.sending) return;
  closeMobileSidebar();
  closeConversationContextMenu();
  resetToNewConversation();
  renderConversationNav();
  elements.input.focus();
});
elements.conversationContextMenu.addEventListener("click", (event) => {
  const action = event.target.closest("[data-conversation-action]")?.dataset.conversationAction;
  if (action) handleConversationContextAction(action);
});
document.addEventListener("pointerdown", (event) => {
  if (!elements.conversationContextMenu.contains(event.target)) closeConversationContextMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeConversationContextMenu();
    closeMobileSidebar();
    if (!elements.studyClockModal.hidden) closeStudyClock();
    if (!elements.apiSettingsModal.hidden) closeApiSettings();
  }
});

elements.studyClockTrigger.addEventListener("click", openStudyClock);
elements.mobileNavToggle.addEventListener("click", toggleMobileSidebar);
elements.mobileNavBackdrop.addEventListener("click", closeMobileSidebar);
elements.clockCloseButton.addEventListener("click", closeStudyClock);
elements.studyClockModal.addEventListener("click", (event) => {
  if (event.target === elements.studyClockModal) closeStudyClock();
});
document.querySelectorAll("[data-clock-mode]").forEach((tab) => {
  tab.addEventListener("click", () => setClockMode(tab.dataset.clockMode));
});
elements.countdownToggle.addEventListener("click", toggleCountdown);
elements.countdownReset.addEventListener("click", resetCountdown);
[elements.countdownHours, elements.countdownMinutes, elements.countdownSeconds].forEach((input) => {
  input.addEventListener("change", () => {
    if (!state.clock.countdown.endsAt) resetCountdown();
  });
});
elements.stopwatchToggle.addEventListener("click", toggleStopwatch);
elements.stopwatchReset.addEventListener("click", resetStopwatch);
elements.focusToggle.addEventListener("click", toggleFocus);
elements.focusReset.addEventListener("click", resetFocus);
elements.focusMinutes.addEventListener("change", () => {
  if (!state.clock.focus.endsAt) resetFocus();
});

document.querySelectorAll("[data-query]").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.dataset.query));
});

document.querySelectorAll(".feature-item").forEach((button) => {
  button.addEventListener("click", () => {
    closeMobileSidebar();
    document.querySelectorAll(".feature-item").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    if (button.dataset.upload !== undefined) {
      return;
    }
    state.attachmentMode = "chat";
    state.targetKnowledgeBase = "";
    elements.knowledgeBaseSelect.value = "";
    showAttachments();
    if (button.dataset.prompt) {
      elements.input.value = button.dataset.prompt;
      autoResize();
      elements.input.focus();
    }
  });
});

document.querySelectorAll("[data-focus-input]").forEach((button) => {
  button.addEventListener("click", () => elements.input.focus());
});

document.querySelectorAll("[data-upload]").forEach((button) => {
  button.addEventListener("click", () => {
    if (state.sending) return;
    state.attachmentMode = "knowledge-upload";
    state.targetKnowledgeBase = "";
    elements.knowledgeBaseSelect.value = "";
    elements.fileInput.multiple = false;
    showAttachments();
    elements.fileInput.click();
  });
});

elements.attachButton.addEventListener("click", () => {
  if (state.sending) return;
  state.attachmentMode = "chat";
  state.targetKnowledgeBase = "";
  elements.knowledgeBaseSelect.value = "";
  elements.fileInput.multiple = true;
  showAttachments();
  elements.fileInput.click();
});
elements.fileInput.addEventListener("change", () => {
  if (state.sending || !elements.fileInput.files?.length) return;
  const selected = Array.from(elements.fileInput.files);
  try {
    validateAttachments(selected, state.attachmentMode);
  } catch (error) {
    window.alert(error.message);
    elements.fileInput.value = "";
    return;
  }
  state.attachments = selected;
  showAttachments();
});
elements.knowledgeBaseSelect.addEventListener("change", () => {
  state.targetKnowledgeBase = elements.knowledgeBaseSelect.value;
});
elements.removeAttachment.addEventListener("click", () => {
  if (state.sending) return;
  state.attachments = [];
  state.attachmentMode = "chat";
  state.targetKnowledgeBase = "";
  elements.fileInput.value = "";
  elements.knowledgeBaseSelect.value = "";
  showAttachments();
});

function createWelcomeFallback() {
  const panel = document.createElement("div");
  panel.className = "welcome";
  panel.innerHTML = "<h2>已创建新的学习对话</h2><p>输入课程问题，或从左侧选择一个学习任务。</p>";
  return panel;
}

elements.fileInput.accept = FILE_ACCEPT;
state.conversationId = window.sessionStorage.getItem("xuetuzhiban-conversation");
if (state.conversationId) {
  registerConversation(state.conversationId, getConversationTitle());
}
renderConversationNav();
if (window.lucide) window.lucide.createIcons();
autoResize();
setClockMode("clock");
window.setInterval(refreshStudyClock, 250);
initializeApiConfig().finally(checkHealth);
if (state.conversationId) {
  const currentConversation = getConversation(state.conversationId);
  if (currentConversation) restoreConversation(currentConversation);
}

window.addEventListener("load", () => {
  document.querySelectorAll(".message-body.markdown").forEach(renderMath);
});
