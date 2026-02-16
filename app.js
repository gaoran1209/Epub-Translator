const form = document.getElementById("translator-form");
const fileInput = document.getElementById("epub-file");
const dropZone = document.getElementById("drop-zone");
const languageInput = document.getElementById("target-language");
const modelProviderInput = document.getElementById("model-provider");
const apiKeyInput = document.getElementById("api-key");
const modelInput = document.getElementById("model-name");
const enableFallbackInput = document.getElementById("enable-fallback");
const fallbackSettingsSection = document.getElementById("fallback-settings");
const zhipuApiKeyInput = document.getElementById("zhipu-api-key");
const zhipuModelInput = document.getElementById("zhipu-model");
const minimaxApiKeyInput = document.getElementById("minimax-api-key");
const minimaxModelInput = document.getElementById("minimax-model");
const kimiApiKeyInput = document.getElementById("kimi-api-key");
const kimiModelInput = document.getElementById("kimi-model");
const systemPromptInput = document.getElementById("system-prompt");
const resetPromptBtn = document.getElementById("reset-prompt-btn");
const translateBtn = document.getElementById("translate-btn");
const cancelBtn = document.getElementById("cancel-btn");
const clearCheckpointBtn = document.getElementById("clear-checkpoint-btn");
const logModeInput = document.getElementById("log-mode");
const clearLogBtn = document.getElementById("clear-log-btn");

const statusText = document.getElementById("status-text");
const progressText = document.getElementById("progress-text");
const progressBar = document.getElementById("progress-bar");
const checkpointHint = document.getElementById("checkpoint-hint");

const fileList = document.getElementById("file-list");
const previewFileTitle = document.getElementById("preview-file-title");
const originalPreview = document.getElementById("original-preview");
const translatedPreview = document.getElementById("translated-preview");

const logPanel = document.getElementById("log-panel");
const logOutput = document.getElementById("log-output");

const result = document.getElementById("result");
const downloadLink = document.getElementById("download-link");

const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_SYSTEM_PROMPT_TEMPLATE = [
  "你是专业电子书翻译助手。",
  "任务：把输入文本准确翻译为{targetLanguage}。",
  "要求：",
  "1) 保持段落与换行结构，不添加额外解释。",
  "2) 专有名词前后一致，必要时采用音译。",
  "3) 不改动 HTML/XHTML 标签结构，只翻译文本内容。",
  "4) 遇到代码、公式、链接、目录编号时保持原样。"
].join("\n");

const MODEL_PROVIDERS = {
  gemini: {
    name: "Google Gemini",
    baseUrl: "",
    defaultModel: "gemini-2.5-flash-lite",
    isGemini: true
  },
  zhipu: {
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    isGemini: false
  },
  minimax: {
    name: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    defaultModel: "MiniMax-Text-01",
    isGemini: false
  },
  kimi: {
    name: "Moonshot Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    isGemini: false
  }
};

const FALLBACK_ORDER = ["zhipu", "minimax", "kimi"];

const CHECKPOINT_DB_NAME = "epub-translator-db";
const CHECKPOINT_STORE_NAME = "checkpoints";
const CHECKPOINT_VERSION = 1;
const CHECKPOINT_PREFIX = "epub-translator:v1:";

const BATCH_MAX_ITEMS = 40;
const BATCH_MAX_CHARS = 8000;
const REQUEST_TIMEOUT_MS = 30000;
const BATCH_CONCURRENCY = 3;
const CHAPTER_CONCURRENCY = 3;

const runtime = {
  fileStates: [],
  selectedFile: "",
  currentContext: null,
  currentDownloadUrl: "",
  logs: [],
  logMode: false,
  previewToken: 0,
  dbPromise: null,
  fileCacheKey: "",
  fileArrayBuffer: null,
  fileHash: "",
  hintTimer: null,
  isRunning: false,
  abortController: null
};

systemPromptInput.value = DEFAULT_SYSTEM_PROMPT_TEMPLATE;
modelInput.value = modelInput.value.trim() || DEFAULT_MODEL;

function setStatus(text) {
  statusText.textContent = text;
}

function setProgress(percent) {
  const value = Math.max(0, Math.min(100, percent));
  progressBar.style.width = `${value}%`;
  progressText.textContent = `Translation Overall Progress - ${Math.round(value)}%`;
}

function formatClockTime(date = new Date()) {
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function logEvent(level, message, details) {
  const detailText = details ? ` | ${details}` : "";
  const line = `[${formatClockTime()}] [${level}] ${message}${detailText}`;
  runtime.logs.push(line);

  if (runtime.logs.length > 600) {
    runtime.logs.shift();
  }

  if (runtime.logMode) {
    logOutput.textContent += (logOutput.textContent ? "\n" : "") + line;
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  const method = level === "ERROR" ? "error" : level === "WARN" ? "warn" : "log";
  console[method](line);
}

function setLogMode(enabled) {
  runtime.logMode = enabled;
  logPanel.classList.toggle("hidden", !enabled);
  if (enabled) {
    logOutput.textContent = runtime.logs.join("\n");
    logOutput.scrollTop = logOutput.scrollHeight;
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeModelName(model) {
  return (model || DEFAULT_MODEL).trim().replace(/^models\//, "") || DEFAULT_MODEL;
}

function getCurrentProviderConfig() {
  const provider = modelProviderInput.value || "gemini";
  const config = MODEL_PROVIDERS[provider];
  return {
    provider,
    ...config,
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim() || config.defaultModel
  };
}

function getFallbackConfigs() {
  const configs = [];

  if (zhipuApiKeyInput.value.trim()) {
    configs.push({
      provider: "zhipu",
      ...MODEL_PROVIDERS.zhipu,
      apiKey: zhipuApiKeyInput.value.trim(),
      model: zhipuModelInput.value.trim() || MODEL_PROVIDERS.zhipu.defaultModel
    });
  }

  if (minimaxApiKeyInput.value.trim()) {
    configs.push({
      provider: "minimax",
      ...MODEL_PROVIDERS.minimax,
      apiKey: minimaxApiKeyInput.value.trim(),
      model: minimaxModelInput.value.trim() || MODEL_PROVIDERS.minimax.defaultModel
    });
  }

  if (kimiApiKeyInput.value.trim()) {
    configs.push({
      provider: "kimi",
      ...MODEL_PROVIDERS.kimi,
      apiKey: kimiApiKeyInput.value.trim(),
      model: kimiModelInput.value.trim() || MODEL_PROVIDERS.kimi.defaultModel
    });
  }

  return configs;
}

function renderSystemPrompt(template, targetLanguage) {
  return String(template || "")
    .replace(/\{\{\s*targetLanguage\s*\}\}/g, targetLanguage)
    .replace(/\{targetLanguage\}/g, targetLanguage);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitOuterWhitespace(text) {
  const leading = (text.match(/^\s*/) || [""])[0];
  const trailing = (text.match(/\s*$/) || [""])[0];
  const core = text.slice(leading.length, text.length - trailing.length);
  return { leading, core, trailing };
}

function buildBatches(items, maxItems = BATCH_MAX_ITEMS, maxChars = BATCH_MAX_CHARS) {
  const batches = [];
  let current = [];
  let currentChars = 0;

  for (const item of items) {
    const len = item.length;
    const shouldSplit =
      current.length > 0 && (current.length >= maxItems || currentChars + len > maxChars);

    if (shouldSplit) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(item);
    currentChars += len;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

function parseDocument(content, fileName) {
  const lower = fileName.toLowerCase();
  const parser = new DOMParser();

  if (/\.(html|htm)$/i.test(lower)) {
    return parser.parseFromString(content, "text/html");
  }

  const xmlDoc = parser.parseFromString(content, "application/xml");
  if (xmlDoc.querySelector("parsererror")) {
    return parser.parseFromString(content, "text/html");
  }

  return xmlDoc;
}

function collectTextNodes(doc) {
  const nodes = [];
  const rejectTags = new Set(["script", "style", "code", "pre", "noscript"]);

  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentName = node.parentElement?.tagName?.toLowerCase() || "";
      if (rejectTags.has(parentName)) {
        return NodeFilter.FILTER_REJECT;
      }

      if (!node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    }
  });

  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }

  return nodes;
}

function parseJsonArray(text) {
  // Attempt 1: direct parse
  try {
    const direct = JSON.parse(text);
    if (Array.isArray(direct)) {
      return direct;
    }
  } catch {
    // noop
  }

  // Attempt 2: extract from fenced code block
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      const value = JSON.parse(fenced[1]);
      if (Array.isArray(value)) {
        return value;
      }
    } catch {
      // noop
    }
  }

  // Attempt 3: extract bracket-delimited substring
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) {
    const slice = text.slice(start, end + 1);
    try {
      const value = JSON.parse(slice);
      if (Array.isArray(value)) {
        return value;
      }
    } catch {
      // noop
    }

    // Attempt 4: fix common issues — trailing commas, unescaped newlines
    try {
      const cleaned = slice
        .replace(/,\s*([\]\}])/g, "$1")
        .replace(/([\[,])\s*,/g, "$1")
        .replace(/\\n/g, "\\n");
      const value = JSON.parse(cleaned);
      if (Array.isArray(value)) {
        return value;
      }
    } catch {
      // noop
    }
  }

  throw new Error("模型返回无法解析为 JSON 数组");
}

function getCandidateFiles(zip) {
  return Object.keys(zip.files)
    .filter((name) => {
      const file = zip.files[name];
      if (!file || file.dir) {
        return false;
      }

      const lower = name.toLowerCase();
      if (lower === "mimetype") {
        return false;
      }

      return /\.(xhtml|html|htm|ncx)$/i.test(lower);
    })
    .sort();
}

function buildPreviewHtml(content) {
  if (!content) {
    return "<p>暂无预览</p>";
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "text/html");
  const nodes = Array.from(doc.querySelectorAll("h1,h2,h3,h4,p,blockquote,li"));
  const chunks = [];

  const maxBlocks = 45;
  for (let i = 0; i < nodes.length && chunks.length < maxBlocks; i += 1) {
    const node = nodes[i];
    const raw = (node.textContent || "").trim();
    if (!raw) {
      continue;
    }

    const text = raw.length > 340 ? `${raw.slice(0, 340)}...` : raw;
    const tag = node.tagName.toLowerCase();
    const safeTag = ["h1", "h2", "h3", "h4", "blockquote"].includes(tag) ? tag : "p";
    chunks.push(`<${safeTag}>${escapeHtml(text)}</${safeTag}>`);
  }

  if (chunks.length === 0) {
    const plain = (doc.body?.textContent || content || "").trim();
    const text = plain.length > 1200 ? `${plain.slice(0, 1200)}...` : plain;
    return `<p>${escapeHtml(text || "暂无文本")}</p>`;
  }

  return chunks.join("\n");
}

function resetPreview() {
  previewFileTitle.textContent = "尚未开始";
  originalPreview.innerHTML = "暂无预览";
  translatedPreview.innerHTML = "暂无预览";
}

function renderFileList() {
  const existingItems = new Map();
  for (const li of fileList.querySelectorAll(".file-item")) {
    existingItems.set(li.dataset.name, li);
  }

  for (const item of runtime.fileStates) {
    const expectedClass = `file-item ${item.status}${runtime.selectedFile === item.name ? " active" : ""}`;
    const label = fileStateLabel(item);
    let li = existingItems.get(item.name);

    if (li) {
      existingItems.delete(item.name);
      if (li.className !== expectedClass) {
        li.className = expectedClass;
      }
      const stateSpan = li.querySelector(".file-state");
      if (stateSpan && stateSpan.textContent !== label) {
        stateSpan.textContent = label;
      }
    } else {
      li = document.createElement("li");
      li.className = expectedClass;
      li.dataset.name = item.name;

      const name = document.createElement("span");
      name.className = "file-name";
      name.title = item.name;
      name.textContent = item.name;

      const state = document.createElement("span");
      state.className = "file-state";
      state.textContent = label;

      li.appendChild(name);
      li.appendChild(state);
      fileList.appendChild(li);
    }
  }

  for (const stale of existingItems.values()) {
    stale.remove();
  }
}

function fileStateLabel(item) {
  if (item.status === "done") {
    return "✓";
  }

  if (item.status === "running") {
    return `${Math.round((item.progress || 0) * 100)}%`;
  }

  if (item.status === "error") {
    return "Error";
  }

  return "Waiting";
}

function setFileStates(fileNames, completedSet) {
  runtime.fileStates = fileNames.map((name) => ({
    name,
    status: completedSet.has(name) ? "done" : "waiting",
    progress: completedSet.has(name) ? 1 : 0,
    error: ""
  }));

  if (!runtime.selectedFile && runtime.fileStates.length > 0) {
    runtime.selectedFile = runtime.fileStates[0].name;
  }

  renderFileList();
  updateOverallProgressFromFileStates();
}

function updateFileState(name, patch) {
  const target = runtime.fileStates.find((item) => item.name === name);
  if (!target) {
    return;
  }

  Object.assign(target, patch);
  renderFileList();
  updateOverallProgressFromFileStates();
}

function updateOverallProgressFromFileStates() {
  if (runtime.fileStates.length === 0) {
    setProgress(0);
    return;
  }

  const total = runtime.fileStates.reduce((sum, item) => sum + Math.max(0, Math.min(1, item.progress || 0)), 0);
  const percent = (total / runtime.fileStates.length) * 100;
  setProgress(percent);
}

async function renderSelectedPreview() {
  const context = runtime.currentContext;
  if (!context || !runtime.selectedFile) {
    resetPreview();
    return;
  }

  const fileName = runtime.selectedFile;
  const token = ++runtime.previewToken;

  previewFileTitle.textContent = fileName;
  originalPreview.innerHTML = "<p>加载中...</p>";

  const source = await getSourceContent(fileName);
  if (token !== runtime.previewToken) {
    return;
  }

  const translated = context.translatedMap.get(fileName) || "";
  originalPreview.innerHTML = buildPreviewHtml(source);
  translatedPreview.innerHTML = translated ? buildPreviewHtml(translated) : "<p>等待翻译...</p>";
}

async function getSourceContent(fileName) {
  const context = runtime.currentContext;
  if (!context) {
    return "";
  }

  if (context.sourceMap.has(fileName)) {
    return context.sourceMap.get(fileName);
  }

  const entry = context.zip.file(fileName);
  if (!entry) {
    return "";
  }

  const content = await entry.async("string");
  context.sourceMap.set(fileName, content);
  return content;
}

function getFileSignature(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

async function sha256HexFromBuffer(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256HexFromText(text) {
  const encoded = new TextEncoder().encode(text);
  return sha256HexFromBuffer(encoded.buffer);
}

async function getFileBufferAndHash(file) {
  const signature = getFileSignature(file);
  if (runtime.fileCacheKey === signature && runtime.fileArrayBuffer && runtime.fileHash) {
    return { arrayBuffer: runtime.fileArrayBuffer, fileHash: runtime.fileHash };
  }

  const arrayBuffer = await file.arrayBuffer();
  const fileHash = await sha256HexFromBuffer(arrayBuffer);

  runtime.fileCacheKey = signature;
  runtime.fileArrayBuffer = arrayBuffer;
  runtime.fileHash = fileHash;

  return { arrayBuffer, fileHash };
}

function getCheckpointId(bookHash, profileHash) {
  return `${CHECKPOINT_PREFIX}${bookHash}:${profileHash}`;
}

function checkpointSummary(record) {
  if (!record || !record.fileOrder || !record.translatedFiles) {
    return "未找到断点";
  }

  const done = Object.keys(record.translatedFiles).length;
  const total = record.fileOrder.length;
  return `检测到断点：${done}/${total} 已完成，更新时间 ${record.updatedAt || "未知"}`;
}

function openCheckpointDb() {
  if (runtime.dbPromise) {
    return runtime.dbPromise;
  }

  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("当前浏览器不支持 IndexedDB"));
  }

  runtime.dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(CHECKPOINT_DB_NAME, CHECKPOINT_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHECKPOINT_STORE_NAME)) {
        db.createObjectStore(CHECKPOINT_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return runtime.dbPromise;
}

async function dbGetCheckpoint(id) {
  const db = await openCheckpointDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKPOINT_STORE_NAME, "readonly");
    const store = tx.objectStore(CHECKPOINT_STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function dbPutCheckpoint(record) {
  const db = await openCheckpointDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKPOINT_STORE_NAME, "readwrite");
    const store = tx.objectStore(CHECKPOINT_STORE_NAME);
    const request = store.put(record);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function dbDeleteCheckpoint(id) {
  const db = await openCheckpointDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKPOINT_STORE_NAME, "readwrite");
    const store = tx.objectStore(CHECKPOINT_STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function resolveCheckpointIdentity() {
  const file = fileInput.files?.[0];
  const targetLanguage = languageInput.value.trim();
  const model = normalizeModelName(modelInput.value.trim() || DEFAULT_MODEL);
  const promptTemplate = (systemPromptInput.value || "").trim();

  if (!file || !targetLanguage || !promptTemplate) {
    return null;
  }

  const { arrayBuffer, fileHash } = await getFileBufferAndHash(file);
  const profileHash = await sha256HexFromText(`${targetLanguage}\n${model}\n${promptTemplate}`);
  const checkpointId = getCheckpointId(fileHash, profileHash);

  return {
    file,
    arrayBuffer,
    bookHash: fileHash,
    targetLanguage,
    model,
    promptTemplate,
    profileHash,
    checkpointId
  };
}

function sanitizeCheckpointRecord(record, fileNames) {
  if (!record || typeof record !== "object") {
    return new Map();
  }

  const allowed = new Set(fileNames);
  const translatedMap = new Map();
  const translatedFiles = record.translatedFiles || {};

  for (const [name, value] of Object.entries(translatedFiles)) {
    if (!allowed.has(name) || typeof value !== "string") {
      continue;
    }

    translatedMap.set(name, value);
  }

  return translatedMap;
}

async function saveCheckpoint({ checkpointId, identity, fileNames, translatedMap, lastError = "" }) {
  const record = {
    id: checkpointId,
    version: 1,
    sourceName: identity.file.name,
    sourceSize: identity.file.size,
    bookHash: identity.bookHash,
    profileHash: identity.profileHash,
    targetLanguage: identity.targetLanguage,
    model: identity.model,
    promptTemplate: identity.promptTemplate,
    fileOrder: fileNames,
    translatedFiles: Object.fromEntries(translatedMap.entries()),
    lastError,
    updatedAt: new Date().toISOString()
  };

  try {
    await dbPutCheckpoint(record);
    checkpointHint.textContent = checkpointSummary(record);
    logEvent("INFO", "已保存断点", `done=${translatedMap.size}/${fileNames.length}`);
  } catch (error) {
    checkpointHint.textContent = `断点保存失败（不影响翻译）：${error.message || "未知错误"}`;
    logEvent("WARN", "断点保存失败", String(error?.message || error));
  }
}

function combineSignals(userSignal) {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (!userSignal) {
    return timeoutSignal;
  }
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([userSignal, timeoutSignal]);
  }
  // Fallback for browsers without AbortSignal.any
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  userSignal.addEventListener("abort", onAbort, { once: true });
  timeoutSignal.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

async function callGeminiBatch({
  apiKey,
  model,
  systemPrompt,
  targetLanguage,
  texts,
  logPrefix = "",
  signal
}) {
  const normalizedModel = normalizeModelName(model);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(normalizedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const combinedSignal = combineSignals(signal);

  const userPrompt = [
    `将下面 JSON 数组中的每一项翻译为${targetLanguage}。`,
    "必须满足：",
    "1) 输出必须是 JSON 数组；",
    "2) 输出数组长度必须与输入一致；",
    "3) 只返回数组内容，不要输出解释；",
    "4) 保持标点、数字、换行结构；",
    "输入：",
    JSON.stringify(texts)
  ].join("\n");

  async function request(body) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: combinedSignal
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Gemini 调用失败 (${response.status}): ${message}`);
    }

    return response.json();
  }

  let data;
  try {
    data = await request({
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    });
  } catch (err) {
    const message = String(err?.message || "");
    if (err.name === "TimeoutError") {
      throw new Error(`${logPrefix}请求超时 (${REQUEST_TIMEOUT_MS / 1000}s)`);
    }
    const unsupportedMime =
      message.includes("responseMimeType") || message.includes("response_mime_type");

    if (!unsupportedMime) {
      throw err;
    }

    logEvent("WARN", `${logPrefix}模型不支持 responseMimeType，改为兼容模式`);

    data = await request({
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userPrompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1
      }
    });
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = data?.promptFeedback?.blockReason || "空响应";
    throw new Error(`Gemini 返回为空 (${reason})`);
  }

  const output = parseJsonArray(text);
  if (output.length !== texts.length) {
    throw new Error(`Gemini 返回长度不匹配，期望 ${texts.length}，实际 ${output.length}`);
  }

  return output.map((item) => (typeof item === "string" ? item : String(item ?? "")));
}

async function callOpenAICompatibleBatch({
  baseUrl,
  apiKey,
  model,
  systemPrompt,
  targetLanguage,
  texts,
  logPrefix = "",
  signal
}) {
  const endpoint = `${baseUrl}/chat/completions`;
  const combinedSignal = combineSignals(signal);

  const userPrompt = [
    `将下面 JSON 数组中的每一项翻译为${targetLanguage}。`,
    "必须满足：",
    "1) 输出必须是 JSON 数组；",
    "2) 输出数组长度必须与输入一致；",
    "3) 只返回数组内容，不要输出解释；",
    "4) 保持标点、数字、换行结构；",
    "输入：",
    JSON.stringify(texts)
  ].join("\n");

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1
      }),
      signal: combinedSignal
    });
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new Error(`${logPrefix}请求超时 (${REQUEST_TIMEOUT_MS / 1000}s)`);
    }
    throw err;
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`API 调用失败 (${response.status}): ${message}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error("API 返回为空");
  }

  const output = parseJsonArray(text);
  if (output.length !== texts.length) {
    throw new Error(`API 返回长度不匹配，期望 ${texts.length}，实际 ${output.length}`);
  }

  return output.map((item) => (typeof item === "string" ? item : String(item ?? "")));
}

async function callModelBatch({
  providerConfig,
  systemPrompt,
  targetLanguage,
  texts,
  logPrefix = "",
  signal
}) {
  const { provider, apiKey, model, baseUrl, isGemini } = providerConfig;

  if (isGemini) {
    return callGeminiBatch({
      apiKey,
      model,
      systemPrompt,
      targetLanguage,
      texts,
      logPrefix,
      signal
    });
  }

  return callOpenAICompatibleBatch({
    baseUrl,
    apiKey,
    model,
    systemPrompt,
    targetLanguage,
    texts,
    logPrefix,
    signal
  });
}

async function translateSingleBatch({
  batch,
  batchIndex,
  totalBatches,
  allConfigs,
  systemPrompt,
  targetLanguage,
  logPrefix,
  signal
}) {
  let lastError;

  // Outer loop: try each provider config
  for (let configIndex = 0; configIndex < allConfigs.length; configIndex += 1) {
    const currentConfig = allConfigs[configIndex];
    const configName = currentConfig.name || currentConfig.provider;

    // Inner loop: retry up to 3 times per provider
    for (let retry = 0; retry < 3; retry += 1) {
      if (signal?.aborted) {
        throw new Error("翻译已取消");
      }

      try {
        logEvent(
          "INFO",
          `${logPrefix}批次 ${batchIndex + 1}/${totalBatches}`,
          `items=${batch.length}, model=${currentConfig.model}, provider=${configName}, retry=${retry}`
        );

        return await callModelBatch({
          providerConfig: currentConfig,
          systemPrompt,
          targetLanguage,
          texts: batch,
          logPrefix,
          signal
        });
      } catch (error) {
        if (error.name === "AbortError" || error.message === "翻译已取消") {
          throw new Error("翻译已取消");
        }
        lastError = error;
        logEvent("WARN", `${logPrefix}${configName} 批次 ${batchIndex + 1} 失败 (retry=${retry})`, String(error?.message || error));

        if (retry < 2) {
          const backoffMs = Math.min(1000 * Math.pow(2, retry), 8000);
          await delay(backoffMs);
        }
      }
    }

    if (configIndex < allConfigs.length - 1) {
      logEvent("INFO", `${logPrefix}切换到备用模型: ${allConfigs[configIndex + 1].name || allConfigs[configIndex + 1].provider}`);
    }
  }

  throw lastError;
}

async function translateTextsInBatches({
  providerConfig,
  fallbackConfigs = [],
  systemPrompt,
  targetLanguage,
  texts,
  onProgress,
  logPrefix,
  signal
}) {
  const batches = buildBatches(texts);
  const allConfigs = [providerConfig, ...fallbackConfigs];
  const results = new Array(batches.length);
  let completedCount = 0;

  // Process batches with controlled concurrency
  const concurrency = Math.min(BATCH_CONCURRENCY, batches.length);
  let nextIndex = 0;
  const errors = [];

  async function worker() {
    while (nextIndex < batches.length) {
      if (signal?.aborted) {
        throw new Error("翻译已取消");
      }

      const myIndex = nextIndex++;
      const batch = batches[myIndex];

      const part = await translateSingleBatch({
        batch,
        batchIndex: myIndex,
        totalBatches: batches.length,
        allConfigs,
        systemPrompt,
        targetLanguage,
        logPrefix,
        signal
      });

      results[myIndex] = part;
      completedCount++;

      if (onProgress) {
        onProgress(completedCount / batches.length);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  // Flatten results in order
  const translated = [];
  for (const part of results) {
    if (part) {
      translated.push(...part);
    }
  }

  return translated;
}

async function translateDocumentContent({
  content,
  fileName,
  providerConfig,
  fallbackConfigs = [],
  systemPrompt,
  targetLanguage,
  onProgress,
  signal
}) {
  const doc = parseDocument(content, fileName);
  const textNodes = collectTextNodes(doc);

  if (textNodes.length === 0) {
    if (onProgress) {
      onProgress(1);
    }
    return content;
  }

  const parts = textNodes.map((node) => splitOuterWhitespace(node.nodeValue || ""));
  const sourceTexts = parts.map((part) => part.core);

  const translatedCores = await translateTextsInBatches({
    providerConfig,
    fallbackConfigs,
    systemPrompt,
    targetLanguage,
    texts: sourceTexts,
    onProgress,
    logPrefix: `[${fileName}] `,
    signal
  });

  for (let i = 0; i < textNodes.length; i += 1) {
    const node = textNodes[i];
    const part = parts[i];
    const translatedCore = translatedCores[i] ?? part.core;
    node.nodeValue = `${part.leading}${translatedCore}${part.trailing}`;
  }

  if (doc.contentType === "text/html") {
    return doc.documentElement.outerHTML;
  }

  return new XMLSerializer().serializeToString(doc);
}

async function buildOutputEpub(zip, translatedMap) {
  const outputZip = new JSZip();

  if (zip.file("mimetype")) {
    const mimetype = await zip.file("mimetype").async("string");
    outputZip.file("mimetype", mimetype, { compression: "STORE" });
  }

  const names = Object.keys(zip.files)
    .filter((name) => name !== "mimetype")
    .sort();

  for (const name of names) {
    const entry = zip.files[name];
    if (!entry) {
      continue;
    }

    if (entry.dir) {
      outputZip.folder(name);
      continue;
    }

    if (translatedMap.has(name)) {
      outputZip.file(name, translatedMap.get(name));
      continue;
    }

    const binary = await zip.file(name).async("uint8array");
    outputZip.file(name, binary);
  }

  return outputZip.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 9 }
  });
}

async function refreshCheckpointHint() {
  const file = fileInput.files?.[0];
  const targetLanguage = languageInput.value.trim();
  const promptTemplate = systemPromptInput.value.trim();

  if (!file) {
    checkpointHint.textContent = "尚未检测到断点。";
    return;
  }

  if (!targetLanguage || !promptTemplate) {
    checkpointHint.textContent = "填写目标语言和 Prompt 模板后可检测断点。";
    return;
  }

  try {
    const identity = await resolveCheckpointIdentity();
    if (!identity) {
      checkpointHint.textContent = "填写目标语言和 Prompt 模板后可检测断点。";
      return;
    }

    const checkpoint = await dbGetCheckpoint(identity.checkpointId);
    checkpointHint.textContent = checkpointSummary(checkpoint);
  } catch (error) {
    checkpointHint.textContent = `断点检测失败：${error.message || "未知错误"}`;
  }
}

function scheduleCheckpointHintRefresh() {
  clearTimeout(runtime.hintTimer);
  runtime.hintTimer = setTimeout(() => {
    refreshCheckpointHint().catch((error) => {
      checkpointHint.textContent = `断点检测失败：${error.message || "未知错误"}`;
    });
  }, 260);
}

async function clearCheckpoint() {
  try {
    const identity = await resolveCheckpointIdentity();
    if (!identity) {
      setStatus("请先选择 EPUB 并填写目标语言后再清除断点。");
      return;
    }

    const confirmed = window.confirm("确定要清除断点吗？清除后将无法恢复已翻译的进度。");
    if (!confirmed) {
      setStatus("已取消清除断点。");
      return;
    }

    await dbDeleteCheckpoint(identity.checkpointId);
    checkpointHint.textContent = "断点已清除。";
    logEvent("INFO", "断点已删除", identity.checkpointId);
    setStatus("已清除当前配置对应的断点。");
  } catch (error) {
    setStatus(`清除断点失败：${error.message || "未知错误"}`);
  }
}

async function runTranslation(signal) {
  if (!window.JSZip) {
    throw new Error("JSZip 加载失败，请检查网络后刷新页面");
  }

  const identity = await resolveCheckpointIdentity();
  const providerConfig = getCurrentProviderConfig();
  const enableFallback = enableFallbackInput.checked;
  const fallbackConfigs = enableFallback ? getFallbackConfigs() : [];

  if (!identity) {
    throw new Error("请先选择 EPUB 并填写目标语言和 Prompt 模板");
  }

  if (!providerConfig.apiKey) {
    throw new Error("请填写 API Key");
  }

  const systemPrompt = renderSystemPrompt(identity.promptTemplate, identity.targetLanguage);
  const zip = await JSZip.loadAsync(identity.arrayBuffer);
  const filesToTranslate = getCandidateFiles(zip);
  let checkpoint = null;
  try {
    checkpoint = await dbGetCheckpoint(identity.checkpointId);
  } catch (error) {
    logEvent("WARN", "读取断点失败，按新任务继续", String(error?.message || error));
  }
  const translatedMap = sanitizeCheckpointRecord(checkpoint, filesToTranslate);

  runtime.currentContext = {
    zip,
    sourceMap: new Map(),
    translatedMap
  };

  runtime.selectedFile = filesToTranslate[0] || "";
  setFileStates(filesToTranslate, new Set(translatedMap.keys()));
  await renderSelectedPreview();

  if (checkpoint) {
    checkpointHint.textContent = checkpointSummary(checkpoint);
    logEvent("INFO", "已加载断点", `done=${translatedMap.size}/${filesToTranslate.length}`);
  }

  if (filesToTranslate.length === 0) {
    throw new Error("未在 EPUB 中找到可翻译的文档文件");
  }

  const failedFiles = [];
  const pendingFiles = filesToTranslate.filter((name) => !translatedMap.has(name));

  if (pendingFiles.length === 0) {
    logEvent("INFO", "所有章节已完成（从断点恢复）");
  } else {
    const chapterConcurrency = Math.min(CHAPTER_CONCURRENCY, pendingFiles.length);
    let nextFileIndex = 0;

    logEvent("INFO", `开始翻译 ${pendingFiles.length} 个章节`, `并发数=${chapterConcurrency}`);

    async function chapterWorker() {
      while (nextFileIndex < pendingFiles.length) {
        if (signal?.aborted) {
          throw new Error("翻译已取消");
        }

        const myIndex = nextFileIndex++;
        const fileName = pendingFiles[myIndex];

        // Update UI for this chapter
        if (!runtime.selectedFile || runtime.selectedFile === pendingFiles[myIndex - 1]) {
          runtime.selectedFile = fileName;
        }
        updateFileState(fileName, { status: "running", progress: 0, error: "" });
        renderFileList();
        setStatus(`正在翻译 (${chapterConcurrency} 并发)：${fileName}`);

        try {
          const sourceContent = await getSourceContent(fileName);
          const translated = await translateDocumentContent({
            content: sourceContent,
            fileName,
            providerConfig,
            fallbackConfigs,
            systemPrompt,
            targetLanguage: identity.targetLanguage,
            onProgress: (progress) => {
              updateFileState(fileName, { status: "running", progress });
              if (runtime.selectedFile === fileName) {
                translatedPreview.innerHTML = `<p>翻译中... ${Math.round(progress * 100)}%</p>`;
              }
            },
            signal
          });

          translatedMap.set(fileName, translated);
          runtime.currentContext.translatedMap = translatedMap;
          updateFileState(fileName, { status: "done", progress: 1 });

          if (runtime.selectedFile === fileName) {
            renderSelectedPreview();
          }

          await saveCheckpoint({
            checkpointId: identity.checkpointId,
            identity,
            fileNames: filesToTranslate,
            translatedMap
          });
        } catch (error) {
          if (error.message === "翻译已取消") {
            updateFileState(fileName, { status: "waiting", progress: 0, error: "" });
            throw error;
          }
          const errorMsg = String(error?.message || error);
          updateFileState(fileName, { status: "error", error: errorMsg });
          failedFiles.push({ fileName, error: errorMsg });

          logEvent("ERROR", `章节翻译失败，跳过继续`, `${fileName}: ${errorMsg}`);

          await saveCheckpoint({
            checkpointId: identity.checkpointId,
            identity,
            fileNames: filesToTranslate,
            translatedMap,
            lastError: `file=${fileName}; error=${errorMsg}`
          });
        }
      }
    }

    const workers = Array.from({ length: chapterConcurrency }, () => chapterWorker());
    await Promise.all(workers);
  }

  if (failedFiles.length > 0) {
    const failedNames = failedFiles.map((f) => f.fileName).join(", ");
    logEvent("WARN", `有 ${failedFiles.length} 个章节翻译失败`, failedNames);
  }

  setStatus("正在生成 EPUB 文件...");
  const outputBlob = await buildOutputEpub(zip, translatedMap);

  const baseName = identity.file.name.replace(/\.epub$/i, "") || "book";
  const langToken =
    identity.targetLanguage.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20) ||
    "translated";
  const outputName = `${baseName}.${langToken}.epub`;

  if (runtime.currentDownloadUrl) {
    URL.revokeObjectURL(runtime.currentDownloadUrl);
  }

  runtime.currentDownloadUrl = URL.createObjectURL(outputBlob);
  downloadLink.href = runtime.currentDownloadUrl;
  downloadLink.download = outputName;
  downloadLink.textContent = `下载 ${outputName}`;

  result.classList.remove("hidden");
  setProgress(100);

  if (failedFiles.length > 0) {
    setStatus(`翻译完成，${failedFiles.length} 个章节失败。可下载 EPUB 后重新翻译失败章节。`);
  } else {
    setStatus("翻译完成，可下载新 EPUB 文件。断点数据已保留，可重复打开。");
  }
}

fileList.addEventListener("click", async (event) => {
  const row = event.target.closest(".file-item");
  if (!row) {
    return;
  }

  const fileName = row.dataset.name;
  if (!fileName) {
    return;
  }

  runtime.selectedFile = fileName;
  renderFileList();
  await renderSelectedPreview();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (runtime.isRunning) {
    return;
  }

  runtime.isRunning = true;
  runtime.abortController = new AbortController();
  translateBtn.disabled = true;
  cancelBtn.disabled = false;
  clearCheckpointBtn.disabled = true;
  result.classList.add("hidden");

  try {
    setStatus("准备翻译任务...");
    await runTranslation(runtime.abortController.signal);
  } catch (error) {
    if (error.message === "翻译已取消") {
      logEvent("INFO", "用户取消了翻译任务");
      setStatus("翻译已取消，可继续翻译未完成章节。");
    } else {
      logEvent("ERROR", "翻译失败", String(error?.message || error));
      setStatus(`翻译失败：${error.message || "未知错误"}`);
    }
  } finally {
    runtime.isRunning = false;
    runtime.abortController = null;
    translateBtn.disabled = false;
    cancelBtn.disabled = true;
    clearCheckpointBtn.disabled = false;
    scheduleCheckpointHintRefresh();
  }
});

cancelBtn.addEventListener("click", () => {
  if (runtime.abortController) {
    runtime.abortController.abort();
    logEvent("INFO", "正在取消翻译...");
    setStatus("正在取消翻译...");
  }
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  updateDropZoneHint(file);
  runtime.fileCacheKey = "";
  runtime.fileArrayBuffer = null;
  runtime.fileHash = "";
  runtime.fileStates = [];
  runtime.selectedFile = "";
  runtime.currentContext = null;
  renderFileList();
  resetPreview();
  setProgress(0);
  scheduleCheckpointHintRefresh();
});

languageInput.addEventListener("input", scheduleCheckpointHintRefresh);
modelInput.addEventListener("input", scheduleCheckpointHintRefresh);
systemPromptInput.addEventListener("input", scheduleCheckpointHintRefresh);

modelProviderInput.addEventListener("change", () => {
  const provider = modelProviderInput.value;
  const config = MODEL_PROVIDERS[provider];
  if (config) {
    modelInput.value = config.defaultModel;
  }
  scheduleCheckpointHintRefresh();
});

enableFallbackInput.addEventListener("change", () => {
  fallbackSettingsSection.classList.toggle("hidden", !enableFallbackInput.checked);
});

if (!enableFallbackInput.checked) {
  fallbackSettingsSection.classList.add("hidden");
}

logModeInput.addEventListener("change", () => {
  setLogMode(logModeInput.checked);
  logEvent("INFO", `Log 模式${logModeInput.checked ? "已启用" : "已关闭"}`);
});

resetPromptBtn.addEventListener("click", () => {
  systemPromptInput.value = DEFAULT_SYSTEM_PROMPT_TEMPLATE;
  scheduleCheckpointHintRefresh();
  setStatus("已恢复默认 Prompt 模板。");
});

clearLogBtn.addEventListener("click", () => {
  runtime.logs = [];
  logOutput.textContent = "";
});

clearCheckpointBtn.addEventListener("click", async () => {
  if (runtime.isRunning) {
    return;
  }

  await clearCheckpoint();
});

function updateDropZoneHint(file) {
  const hint = dropZone.querySelector(".drop-zone-hint");
  if (file) {
    hint.textContent = `已选择: ${file.name}`;
    dropZone.classList.add("has-file");
  } else {
    hint.textContent = "拖拽 EPUB 文件到此处，或点击选择文件";
    dropZone.classList.remove("has-file");
  }
}

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove("drag-over");

  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const file = files[0];
    if (file.name.toLowerCase().endsWith(".epub") || file.type === "application/epub+zip") {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event("change"));
      updateDropZoneHint(file);
    } else {
      setStatus("请上传 EPUB 格式的文件");
    }
  }
});

setLogMode(false);
resetPreview();
setProgress(0);
setStatus("等待上传文件");
scheduleCheckpointHintRefresh();
