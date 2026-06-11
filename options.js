const DEFAULT_SETTINGS = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4.1-mini",
  systemPrompt:
    "你是一个嵌入 Chrome 扩展里的日常网页 AI 助手。请用中文清楚、简洁、实用地回答，必要时保留 Markdown 结构。",
  temperature: 0.3
};

const BOLD_NOTES_KEY = "boldNotes";
const BOLD_NOTE_DESTINATIONS_KEY = "boldNoteDestinations";
const PENDING_LOCATE_KEY = "pendingBoldNoteLocate";
const LOCAL_DESTINATION_ID = "local";

const form = document.getElementById("settings-form");
const statusText = document.getElementById("status");
const notesList = document.getElementById("notes-list");
const clearNotesButton = document.getElementById("clear-notes");
const chooseNoteFolderButton = document.getElementById("choose-note-folder");
const syncNotesFileButton = document.getElementById("sync-notes-file");
const notePathStatus = document.getElementById("note-path-status");
const noteDestinationsList = document.getElementById("note-destinations-list");

const DB_NAME = "dailyAiHelper";
const DB_STORE = "handles";
const LEGACY_NOTE_FOLDER_KEY = "noteFolder";

start();

async function start() {
  await initialize();
  await migrateLegacyDestination();
  await renderNotePath();
  await renderNotes();
  await syncNotesToFile({ quiet: true });
  focusApiKeyFromHash();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(form);
  const payload = {
    apiKey: String(formData.get("apiKey") || "").trim(),
    baseUrl: String(formData.get("baseUrl") || "").trim() || DEFAULT_SETTINGS.baseUrl,
    model: String(formData.get("model") || "").trim() || DEFAULT_SETTINGS.model,
    systemPrompt: String(formData.get("systemPrompt") || "").trim() || DEFAULT_SETTINGS.systemPrompt,
    temperature: normalizeTemperature(formData.get("temperature"))
  };

  await chrome.storage.sync.set(payload);
  statusText.textContent = `已保存 ${new Date().toLocaleTimeString()}`;
});

clearNotesButton.addEventListener("click", async () => {
  await chrome.storage.local.set({ [BOLD_NOTES_KEY]: [] });
  await renderNotes();
  await syncNotesToFile({ quiet: true });
});

chooseNoteFolderButton.addEventListener("click", addNoteDestination);

syncNotesFileButton.addEventListener("click", async () => {
  await syncNotesToFile();
});

noteDestinationsList.addEventListener("click", async (event) => {
  const toggleButton = event.target.closest("[data-toggle-destination]");
  if (toggleButton) {
    await toggleDestination(toggleButton.getAttribute("data-toggle-destination"));
    return;
  }

  const renameButton = event.target.closest("[data-rename-destination]");
  if (renameButton) {
    await renameDestination(renameButton.getAttribute("data-rename-destination"));
    return;
  }

  const syncButton = event.target.closest("[data-sync-destination]");
  if (syncButton) {
    await syncNotesToFile({ destinationId: syncButton.getAttribute("data-sync-destination") });
    return;
  }

  const deleteButton = event.target.closest("[data-delete-destination]");
  if (deleteButton) {
    await deleteDestination(deleteButton.getAttribute("data-delete-destination"));
  }
});

notesList.addEventListener("click", async (event) => {
  const locateButton = event.target.closest("[data-locate-note]");
  if (locateButton) {
    const id = locateButton.getAttribute("data-locate-note");
    const notes = await getNotes();
    const note = notes.find((entry) => entry.id === id);
    if (note?.pageUrl) {
      await chrome.storage.local.set({
        [PENDING_LOCATE_KEY]: {
          id: note.id,
          text: note.text,
          pageUrl: note.pageUrl,
          pageTitle: note.pageTitle,
          createdAt: note.createdAt,
          requestedAt: Date.now()
        }
      });
      await chrome.tabs.create({ url: note.pageUrl });
    }
    return;
  }

  const deleteButton = event.target.closest("[data-delete-note]");
  if (!deleteButton) {
    return;
  }

  const id = deleteButton.getAttribute("data-delete-note");
  const notes = await getNotes();
  await chrome.storage.local.set({
    [BOLD_NOTES_KEY]: notes.filter((note) => note.id !== id)
  });
  await renderNotes();
  await syncNotesToFile({ quiet: true });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes[BOLD_NOTES_KEY]) {
    renderNotes();
    syncNotesToFile({ quiet: true });
  }

  if (changes[BOLD_NOTE_DESTINATIONS_KEY]) {
    renderNotePath();
  }
});

async function initialize() {
  const settings = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const values = { ...DEFAULT_SETTINGS, ...settings };

  for (const [key, value] of Object.entries(values)) {
    const field = document.getElementById(key);
    if (field) {
      field.value = value;
    }
  }
}

function focusApiKeyFromHash() {
  if (location.hash !== "#apiKey") {
    return;
  }

  const field = document.getElementById("apiKey");
  field?.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => field?.focus(), 250);
}

async function addNoteDestination() {
  if (!window.showDirectoryPicker) {
    notePathStatus.textContent = "当前浏览器不支持选择本地文件夹。请升级 Chrome 后再试。";
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({
      id: "daily-ai-helper-notes",
      mode: "readwrite"
    });
    const rawName = window.prompt("给这个笔记地址起个名字", handle.name || "加粗笔记");
    const name = String(rawName || "").trim();

    if (!name) {
      notePathStatus.textContent = "已取消新增地址。";
      return;
    }

    const destination = {
      id: `dest-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      folderName: handle.name || "已选择文件夹",
      enabled: true,
      createdAt: Date.now()
    };
    const destinations = await getDestinations();

    await saveDirectoryHandle(destination.id, handle);
    await saveDestinations([destination, ...destinations]);
    await renderNotePath();
    await syncNotesToFile({ destinationId: destination.id, quiet: true });
  } catch (error) {
    if (error?.name !== "AbortError") {
      notePathStatus.textContent = `选择文件夹失败：${error.message || String(error)}`;
    }
  }
}

async function renderNotes() {
  const notes = await getNotes();

  clearNotesButton.disabled = notes.length === 0;

  if (notes.length === 0) {
    notesList.innerHTML = `<p class="empty-notes">还没有加粗笔记。选中文字后点工具条里的“加粗”，这里就会自动记录。</p>`;
    return;
  }

  notesList.innerHTML = notes
    .map(
      (note) => `
        <article class="note-item">
          <p class="note-text">${escapeHtml(note.text)}</p>
          <div class="note-meta">
            <span class="destination-badge">${escapeHtml(getNoteDestinationName(note))}</span>
            <a href="${escapeAttribute(note.pageUrl)}" target="_blank" rel="noreferrer">${escapeHtml(note.pageTitle || "来源页面")}</a>
            <span>${escapeHtml(formatDate(note.createdAt))}</span>
            <button type="button" data-locate-note="${escapeAttribute(note.id)}">定位原文</button>
            <button type="button" data-delete-note="${escapeAttribute(note.id)}">删除</button>
          </div>
        </article>
      `
    )
    .join("");
}

async function renderNotePath() {
  const destinations = await getDestinations();
  const enabledCount = destinations.filter((destination) => destination.enabled).length;

  syncNotesFileButton.disabled = destinations.length === 0;

  if (destinations.length === 0) {
    notePathStatus.textContent = "当前没有外部笔记地址。加粗内容会先保存在扩展本地笔记里。";
    noteDestinationsList.innerHTML = `<p class="empty-notes">点击“新增地址”选择文件夹，并给它起一个容易区分的名字。</p>`;
    return;
  }

  notePathStatus.textContent = `已有 ${destinations.length} 个地址，当前启用 ${enabledCount} 个。启用多个地址时，每次加粗都会让你选择保存位置。`;
  noteDestinationsList.innerHTML = destinations.map(renderDestinationItem).join("");
}

function renderDestinationItem(destination) {
  const fileName = getDestinationFileName(destination);
  const enabledText = destination.enabled ? "暂停" : "启用";
  const statusText = destination.enabled ? "已启用" : "已暂停";

  return `
    <article class="destination-item ${destination.enabled ? "enabled" : "paused"}">
      <div class="destination-main">
        <strong>${escapeHtml(destination.name)}</strong>
        <span>${escapeHtml(statusText)} · ${escapeHtml(destination.folderName || "已选择文件夹")} / ${escapeHtml(fileName)}</span>
      </div>
      <div class="destination-actions">
        <button type="button" class="secondary-button" data-toggle-destination="${escapeAttribute(destination.id)}">${enabledText}</button>
        <button type="button" class="secondary-button" data-rename-destination="${escapeAttribute(destination.id)}">重命名</button>
        <button type="button" class="secondary-button" data-sync-destination="${escapeAttribute(destination.id)}">同步</button>
        <button type="button" class="secondary-button danger-button" data-delete-destination="${escapeAttribute(destination.id)}">删除</button>
      </div>
    </article>
  `;
}

async function toggleDestination(id) {
  const destinations = await getDestinations();
  await saveDestinations(
    destinations.map((destination) =>
      destination.id === id ? { ...destination, enabled: !destination.enabled } : destination
    )
  );
  await renderNotePath();
}

async function renameDestination(id) {
  const destinations = await getDestinations();
  const destination = destinations.find((entry) => entry.id === id);
  if (!destination) {
    return;
  }

  const rawName = window.prompt("新的地址名称", destination.name);
  const name = String(rawName || "").trim();
  if (!name || name === destination.name) {
    return;
  }

  await saveDestinations(
    destinations.map((entry) => (entry.id === id ? { ...entry, name } : entry))
  );
  const notes = await getNotes();
  await chrome.storage.local.set({
    [BOLD_NOTES_KEY]: notes.map((note) =>
      note.destinationId === id ? { ...note, destinationName: name } : note
    )
  });
  await renderNotePath();
  await renderNotes();
  await syncNotesToFile({ destinationId: id, quiet: true });
}

async function deleteDestination(id) {
  const destinations = await getDestinations();
  const destination = destinations.find((entry) => entry.id === id);
  if (!destination) {
    return;
  }

  if (!window.confirm(`删除地址“${destination.name}”？已有笔记仍会保留在扩展本地。`)) {
    return;
  }

  await deleteDirectoryHandle(id);
  await saveDestinations(destinations.filter((entry) => entry.id !== id));
  await renderNotePath();
  await renderNotes();
}

async function syncNotesToFile({ destinationId, quiet = false } = {}) {
  const destinations = await getDestinations();
  const targets = destinationId
    ? destinations.filter((destination) => destination.id === destinationId)
    : destinations;

  if (targets.length === 0) {
    if (!quiet) {
      notePathStatus.textContent = "还没有可以同步的笔记地址。";
    }
    return;
  }

  const notes = await getNotes();
  let successCount = 0;
  let failureMessage = "";

  for (const destination of targets) {
    try {
      await syncDestinationToFile(destination, notes.filter((note) => note.destinationId === destination.id), {
        requestPermission: !quiet
      });
      successCount += 1;
    } catch (error) {
      failureMessage = `${destination.name} 同步失败：${error.message || String(error)}`;
    }
  }

  if (quiet) {
    return;
  }

  if (failureMessage) {
    notePathStatus.textContent = failureMessage;
    return;
  }

  notePathStatus.textContent = `已同步 ${successCount} 个地址：${new Date().toLocaleTimeString()}`;
}

async function syncDestinationToFile(destination, notes, { requestPermission = true } = {}) {
  const handle = await getDirectoryHandle(destination.id);
  if (!handle) {
    throw new Error("找不到文件夹权限，请删除后重新添加地址。");
  }

  const hasPermission = await ensureReadWritePermission(handle, requestPermission);
  if (!hasPermission) {
    throw new Error("没有文件夹写入权限，请重新授权。");
  }

  const fileHandle = await handle.getFileHandle(getDestinationFileName(destination), { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(buildNotesMarkdown(notes, destination));
  await writable.close();
}

function buildNotesMarkdown(notes, destination) {
  if (notes.length === 0) {
    return `# ${destination.name}\n\n暂无加粗笔记。\n`;
  }

  return [
    `# ${destination.name}`,
    "",
    `更新时间：${new Date().toLocaleString()}`,
    "",
    ...notes.map((note, index) =>
      [
        `## ${index + 1}. ${safeMarkdownTitle(note.text)}`,
        "",
        `- 来源：${note.pageTitle || "未命名页面"}`,
        `- 链接：${note.pageUrl || ""}`,
        `- 加粗日期：${formatDate(note.createdAt)}`,
        "",
        "> " + String(note.text || "").replace(/\n/g, "\n> "),
        ""
      ].join("\n")
    )
  ].join("\n");
}

async function migrateLegacyDestination() {
  const destinations = await getDestinations();
  if (destinations.length > 0) {
    return;
  }

  const legacyHandle = await getDirectoryHandle(LEGACY_NOTE_FOLDER_KEY);
  if (!legacyHandle) {
    return;
  }

  const destination = {
    id: `dest-${Date.now()}-legacy`,
    name: "加粗笔记",
    folderName: legacyHandle.name || "旧笔记文件夹",
    enabled: true,
    createdAt: Date.now()
  };

  await saveDirectoryHandle(destination.id, legacyHandle);
  await deleteDirectoryHandle(LEGACY_NOTE_FOLDER_KEY);
  await saveDestinations([destination]);

  const notes = await getNotes();
  const migratedNotes = notes.map((note) =>
    note.destinationId
      ? note
      : {
          ...note,
          destinationId: destination.id,
          destinationName: destination.name
        }
  );
  await chrome.storage.local.set({ [BOLD_NOTES_KEY]: migratedNotes });
}

function getNoteDestinationName(note) {
  return note.destinationName || (note.destinationId === LOCAL_DESTINATION_ID ? "本地笔记" : "未分类");
}

function getDestinationFileName(destination) {
  const name = safeFileName(destination.name) || "加粗笔记";
  return name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
}

function safeFileName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function safeMarkdownTitle(text) {
  const title = String(text || "").replace(/\s+/g, " ").trim();
  return title.length > 42 ? `${title.slice(0, 42)}...` : title || "未命名笔记";
}

async function ensureReadWritePermission(handle, shouldRequest = true) {
  const options = { mode: "readwrite" };

  if ((await handle.queryPermission(options)) === "granted") {
    return true;
  }

  if (!shouldRequest) {
    return false;
  }

  return (await handle.requestPermission(options)) === "granted";
}

async function getDirectoryHandle(key) {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const request = tx.objectStore(DB_STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function saveDirectoryHandle(key, handle) {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(handle, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteDirectoryHandle(key) {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getNotes() {
  const data = await chrome.storage.local.get(BOLD_NOTES_KEY);
  return Array.isArray(data[BOLD_NOTES_KEY]) ? data[BOLD_NOTES_KEY] : [];
}

async function getDestinations() {
  const data = await chrome.storage.local.get(BOLD_NOTE_DESTINATIONS_KEY);
  return Array.isArray(data[BOLD_NOTE_DESTINATIONS_KEY])
    ? data[BOLD_NOTE_DESTINATIONS_KEY].map(normalizeDestination).filter(Boolean)
    : [];
}

async function saveDestinations(destinations) {
  await chrome.storage.local.set({
    [BOLD_NOTE_DESTINATIONS_KEY]: destinations.map(normalizeDestination).filter(Boolean)
  });
}

function normalizeDestination(destination) {
  if (!destination?.id || !destination?.name) {
    return null;
  }

  return {
    id: String(destination.id),
    name: String(destination.name).trim() || "加粗笔记",
    folderName: String(destination.folderName || "已选择文件夹"),
    enabled: destination.enabled !== false,
    createdAt: Number(destination.createdAt || Date.now())
  };
}

function normalizeTemperature(value) {
  const number = Number(value);

  if (Number.isNaN(number)) {
    return DEFAULT_SETTINGS.temperature;
  }

  return Math.max(0, Math.min(2, number));
}

function formatDate(value) {
  if (!value) {
    return "未知时间";
  }

  return new Date(value).toLocaleString();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
