(() => {
  const GLOBAL_KEY = "__DAILY_AI_CONTEXT_HELPER_V2__";
  const HOST_ID = "ai-context-menu-helper-root";
  const PENDING_LOCATE_KEY = "pendingBoldNoteLocate";

  if (globalThis[GLOBAL_KEY]) {
    return;
  }

  globalThis[GLOBAL_KEY] = true;

  const BOLD_NOTES_KEY = "boldNotes";
  const BOLD_NOTE_DESTINATIONS_KEY = "boldNoteDestinations";
  const LOCAL_DESTINATION = {
    id: "local",
    name: "本地笔记",
    folderName: "",
    enabled: true
  };

  const TOOLBAR_ACTIONS = [
    { id: "translate", label: "翻译", mark: "译" },
    { id: "summarize", label: "总结", mark: "Σ" },
    { id: "explain", label: "解释", mark: "?" },
    { id: "bold", label: "加粗", mark: "B" },
    { id: "polish", label: "润色", mark: "✎" }
  ];

  let host;
  let shadow;
  let selectionTimer;
  let destinationPickerResolver;
  let state = {
    isOpen: false,
    activeRequest: null,
    selectionText: "",
    selectionRect: null,
    destinationPicker: null
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "AI_CONTEXT_MENU_LOCAL_ACTION" && message.payload?.action === "bold") {
      applyBoldToCurrentSelection(message.payload?.input);
      return;
    }

    if (message?.type === "AI_CONTEXT_MENU_REQUEST" || message?.type === "AI_CONTEXT_MENU_RESULT") {
      state = {
        ...state,
        isOpen: true,
        activeRequest: message.payload,
        selectionText: "",
        selectionRect: null
      };
      render();
    }
  });

  document.addEventListener("mousedown", beginSelection, true);
  document.addEventListener("touchstart", beginSelection, true);
  document.addEventListener("mouseup", finishSelection, true);
  document.addEventListener("touchend", finishSelection, true);
  document.addEventListener("keyup", finishSelection, true);
  window.addEventListener("scroll", hideToolbar, true);
  window.addEventListener("resize", hideToolbar, true);

  window.setTimeout(checkPendingBoldNoteLocate, 700);

  function beginSelection(event) {
    if (host?.contains(event.target)) {
      return;
    }

    clearTimeout(selectionTimer);
    hideToolbar();
  }

  function finishSelection(event) {
    if (host?.contains(event.target)) {
      return;
    }

    clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(updateToolbarFromSelection, 180);
  }

  function updateToolbarFromSelection() {
    const selection = window.getSelection();
    const selectedText = String(selection?.toString() || "").trim();

    if (!selection || selection.rangeCount === 0 || selectedText.length < 2) {
      hideToolbar();
      return;
    }

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      hideToolbar();
      return;
    }

    const toolbarWidth = 344;
    const toolbarHeight = 44;
    const gap = 10;
    const left = clamp(rect.left + rect.width / 2 - toolbarWidth / 2, 10, window.innerWidth - toolbarWidth - 10);
    const top = rect.top - toolbarHeight - gap > 10 ? rect.top - toolbarHeight - gap : rect.bottom + gap;

    state = {
      ...state,
      selectionText: selectedText,
      selectionRect: {
        left,
        top: clamp(top, 10, window.innerHeight - toolbarHeight - 10)
      }
    };

    render();
  }

  function ensureRoot() {
    host = document.getElementById(HOST_ID);

    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      document.documentElement.append(host);
    }

    if (!shadow) {
      shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    }
  }

  function render() {
    ensureRoot();
    const request = state.activeRequest;

    shadow.innerHTML = `
      <style>${getStyles()}</style>
      ${renderToolbar()}
      ${request ? renderPanel(request) : ""}
      ${state.destinationPicker ? renderDestinationPicker(state.destinationPicker) : ""}
    `;

    bindToolbar();
    if (request) {
      bindPanel(request);
    }
    bindDestinationPicker();
  }

  function renderToolbar() {
    if (!state.selectionText || !state.selectionRect) {
      return "";
    }

    return `
      <div class="selection-toolbar" style="left:${Math.round(state.selectionRect.left)}px;top:${Math.round(state.selectionRect.top)}px;" role="toolbar" aria-label="AI 快捷工具条">
        <button class="toolbar-main" type="button" data-toolbar-action="translate" title="翻译">
          <span>译</span>
          <strong>翻译</strong>
        </button>
        <div class="toolbar-divider" aria-hidden="true"></div>
        ${TOOLBAR_ACTIONS.slice(1)
          .map(
            (action) => `
              <button class="toolbar-action" type="button" data-toolbar-action="${escapeHtml(action.id)}" title="${escapeHtml(action.label)}">
                <span>${escapeHtml(action.mark)}</span>
                <small>${escapeHtml(action.label)}</small>
              </button>
            `
          )
          .join("")}
        <div class="toolbar-divider" aria-hidden="true"></div>
        <button class="toolbar-close" type="button" id="toolbar-close" title="关闭" aria-label="关闭">×</button>
      </div>
    `;
  }

  function renderPanel(request) {
    const status = getStatusMeta(request);

    return `
      <aside class="mac-window ${state.isOpen ? "open" : ""}" role="dialog" aria-label="日常 AI 助手">
        <header class="titlebar">
          <div class="traffic" aria-hidden="true">
            <button class="dot close-dot" id="close-button" type="button" title="关闭"></button>
            <span class="dot min-dot"></span>
            <span class="dot max-dot"></span>
          </div>
          <div class="window-title">日常 AI 助手</div>
          <button class="settings-button" id="settings-button" type="button">设置</button>
        </header>

        <section class="hero">
          <div class="app-icon" aria-hidden="true">${escapeHtml(getActionMark(request.action))}</div>
          <div class="hero-copy">
            <p>${escapeHtml(request.actionTitle || "AI")}</p>
            <h2>${escapeHtml(status.title)}</h2>
          </div>
        </section>

        <nav class="quick-actions" aria-label="快捷动作">
          ${renderActionButtons(request)}
        </nav>

        ${request.action === "translate" ? renderTranslationTools(request) : ""}

        <section class="status-line ${status.className}">
          <span aria-hidden="true"></span>
          <p>${escapeHtml(status.description)}</p>
        </section>

        <section class="content-area">
          <details class="source">
            <summary>
              <span>选中文本</span>
              <small>${escapeHtml(formatTextLength(request.input))}</small>
            </summary>
            <div class="source-text">${escapeHtml(request.input || "没有收到选中文本")}</div>
          </details>

          <section class="answer">
            <div class="answer-head">
              <span>AI 结果</span>
              <button class="copy-button" id="copy-button" type="button" ${request.status === "done" ? "" : "disabled"}>复制</button>
            </div>
            <div class="answer-body">
              ${renderResult(request)}
            </div>
          </section>
        </section>
      </aside>
    `;
  }

  function renderDestinationPicker(picker) {
    const destinations = Array.isArray(picker.destinations) ? picker.destinations : [];

    return `
      <section class="destination-picker" role="dialog" aria-label="选择加粗笔记地址">
        <div class="destination-sheet">
          <div class="destination-sheet-head">
            <span aria-hidden="true">B</span>
            <div>
              <strong>保存到哪里？</strong>
              <p>你启用了多个加粗地址，这条笔记需要选择一个保存位置。</p>
            </div>
          </div>
          <div class="destination-options">
            ${destinations
              .map(
                (destination) => `
                  <button type="button" data-pick-destination="${escapeHtml(destination.id)}">
                    <strong>${escapeHtml(destination.name)}</strong>
                    <small>${escapeHtml(destination.folderName || "本地笔记")}</small>
                  </button>
                `
              )
              .join("")}
          </div>
          <div class="destination-sheet-actions">
            <button class="destination-cancel" id="destination-cancel" type="button">取消保存</button>
          </div>
        </div>
      </section>
    `;
  }

  function renderActionButtons(request) {
    const actions = Array.isArray(request.actions) ? request.actions : [];
    return actions
      .map((action) => {
        const active = action.id === request.action ? "active" : "";
        return `
          <button class="action-pill ${active}" type="button" data-panel-action="${escapeHtml(action.id)}" ${request.status === "loading" ? "disabled" : ""}>
            ${escapeHtml(action.title)}
          </button>
        `;
      })
      .join("");
  }

  function renderTranslationTools(request) {
    const targets = Array.isArray(request.targetLanguages) ? request.targetLanguages : [];
    const current = request.targetLanguage || "中文";
    const isCustom = current && !targets.includes(current);
    const options = targets
      .map((target) => `<option value="${escapeHtml(target)}" ${target === current ? "selected" : ""}>${escapeHtml(target)}</option>`)
      .join("");

    return `
      <section class="translation-tools">
        <label>
          <span>目标语言</span>
          <select id="target-language" ${request.status === "loading" ? "disabled" : ""}>
            ${options}
            <option value="__custom__" ${isCustom ? "selected" : ""}>自定义...</option>
          </select>
        </label>
        <div class="custom-target">
          <input id="custom-language" type="text" value="${isCustom ? escapeHtml(current) : ""}" placeholder="例如：越南语、繁体中文" ${request.status === "loading" ? "disabled" : ""}>
          <button id="custom-translate-button" type="button" ${request.status === "loading" ? "disabled" : ""}>翻译</button>
        </div>
      </section>
    `;
  }

  function renderResult(request) {
    if (request.status === "needs_api_key") {
      return `
        <div class="api-key-card">
          <strong>需要先填写 API Key</strong>
          <p>加粗和加粗笔记可以离线使用；翻译、总结、解释和润色需要连接模型 API。</p>
          <button id="open-api-settings" type="button">去填写 API</button>
        </div>
      `;
    }

    if (request.status === "error") {
      return `<pre class="error-text">${escapeHtml(request.error || "请求失败，请检查设置。")}</pre>`;
    }

    if (request.status === "done") {
      return `<div class="markdown">${renderMarkdownLite(request.output || "没有返回内容")}</div>`;
    }

    return `
      <div class="loading-card">
        <div class="loader" aria-hidden="true"><span></span><span></span><span></span></div>
        <p>正在处理这段文字...</p>
      </div>
    `;
  }

  function bindToolbar() {
    shadow.getElementById("toolbar-close")?.addEventListener("mousedown", (event) => event.preventDefault());
    shadow.getElementById("toolbar-close")?.addEventListener("click", () => hideToolbar());

    for (const button of shadow.querySelectorAll("[data-toolbar-action]")) {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        const actionId = button.getAttribute("data-toolbar-action");
        const input = state.selectionText;

        if (actionId === "bold") {
          applyBoldToCurrentSelection(input);
          hideToolbar();
          return;
        }

        hideToolbar(false);
        runAction({ actionId, input });
      });
    }
  }

  function bindPanel(request) {
    shadow.getElementById("close-button")?.addEventListener("click", closePanel);
    shadow.getElementById("settings-button")?.addEventListener("click", () => openSettings());
    shadow.getElementById("open-api-settings")?.addEventListener("click", () => openSettings("apiKey"));
    shadow.getElementById("copy-button")?.addEventListener("click", () => copyOutput(request.output || ""));

    for (const button of shadow.querySelectorAll("[data-panel-action]")) {
      button.addEventListener("click", () => {
        const actionId = button.getAttribute("data-panel-action");

        if (actionId === "bold") {
          applyBoldToCurrentSelection(request.input);
          return;
        }

        runAction({
          actionId,
          input: request.input,
          targetLanguage: getTargetLanguage(request)
        });
      });
    }

    const select = shadow.getElementById("target-language");
    const customInput = shadow.getElementById("custom-language");
    const customButton = shadow.getElementById("custom-translate-button");

    select?.addEventListener("change", () => {
      if (select.value === "__custom__") {
        customInput?.focus();
        return;
      }

      runAction({
        actionId: "translate",
        input: request.input,
        targetLanguage: select.value
      });
    });

    customButton?.addEventListener("click", () => {
      const targetLanguage = customInput?.value?.trim();
      if (targetLanguage) {
        runAction({ actionId: "translate", input: request.input, targetLanguage });
      }
    });

    customInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const targetLanguage = customInput.value.trim();
        if (targetLanguage) {
          runAction({ actionId: "translate", input: request.input, targetLanguage });
        }
      }
    });
  }

  function bindDestinationPicker() {
    if (!state.destinationPicker) {
      return;
    }

    shadow.getElementById("destination-cancel")?.addEventListener("click", () => resolveDestinationPicker(null));

    for (const button of shadow.querySelectorAll("[data-pick-destination]")) {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-pick-destination");
        const destination = state.destinationPicker.destinations.find((entry) => entry.id === id);
        resolveDestinationPicker(destination || null);
      });
    }
  }

  function runAction({ actionId, input, targetLanguage }) {
    if (!actionId || !input) {
      return;
    }

    chrome.runtime.sendMessage({
      type: "AI_CONTEXT_MENU_RUN_ACTION",
      payload: {
        actionId,
        input,
        targetLanguage
      }
    });
  }

  async function applyBoldToCurrentSelection(fallbackText = "") {
    const activeElement = document.activeElement;
    const noteText = getSelectedTextForNote(activeElement, fallbackText);

    if (isEditableElement(activeElement)) {
      document.execCommand("bold");
      await saveBoldNote(noteText);
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }

    const range = selection.getRangeAt(0);
    const strong = document.createElement("strong");
    strong.append(range.extractContents());
    range.insertNode(strong);
    selection.removeAllRanges();
    await saveBoldNote(noteText);
  }

  function getSelectedTextForNote(activeElement, fallbackText) {
    if (isEditableElement(activeElement) && typeof activeElement.selectionStart === "number") {
      return String(activeElement.value || "")
        .slice(activeElement.selectionStart, activeElement.selectionEnd)
        .trim() || String(fallbackText || "").trim();
    }

    return String(window.getSelection()?.toString() || fallbackText || "").trim();
  }

  async function saveBoldNote(text) {
    const noteText = String(text || "").trim();
    if (!noteText) {
      return;
    }

    const destination = await resolveBoldNoteDestination();
    if (!destination) {
      showLocateToast("已加粗，未保存为笔记。");
      return;
    }

    const data = await chrome.storage.local.get(BOLD_NOTES_KEY);
    const notes = Array.isArray(data[BOLD_NOTES_KEY]) ? data[BOLD_NOTES_KEY] : [];

    notes.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      text: noteText,
      pageTitle: document.title || "未命名页面",
      pageUrl: location.href,
      createdAt: Date.now(),
      destinationId: destination.id,
      destinationName: destination.name
    });

    await chrome.storage.local.set({
      [BOLD_NOTES_KEY]: notes.slice(0, 300)
    });

    showLocateToast(`已保存到：${destination.name}`);
  }

  async function resolveBoldNoteDestination() {
    const destinations = await getActiveBoldDestinations();

    if (destinations.length === 0) {
      return LOCAL_DESTINATION;
    }

    if (destinations.length === 1) {
      return destinations[0];
    }

    return showDestinationPicker(destinations);
  }

  async function getActiveBoldDestinations() {
    const data = await chrome.storage.local.get(BOLD_NOTE_DESTINATIONS_KEY);
    const destinations = Array.isArray(data[BOLD_NOTE_DESTINATIONS_KEY]) ? data[BOLD_NOTE_DESTINATIONS_KEY] : [];

    return destinations
      .filter((destination) => destination?.enabled !== false && destination?.id && destination?.name)
      .map((destination) => ({
        id: String(destination.id),
        name: String(destination.name),
        folderName: String(destination.folderName || "")
      }));
  }

  function showDestinationPicker(destinations) {
    return new Promise((resolve) => {
      destinationPickerResolver = resolve;
      state = {
        ...state,
        selectionText: "",
        selectionRect: null,
        destinationPicker: {
          destinations
        }
      };
      render();
    });
  }

  function resolveDestinationPicker(destination) {
    const resolve = destinationPickerResolver;
    destinationPickerResolver = null;
    state = {
      ...state,
      destinationPicker: null
    };
    render();

    if (resolve) {
      resolve(destination);
    }
  }

  async function checkPendingBoldNoteLocate() {
    const data = await chrome.storage.local.get(PENDING_LOCATE_KEY);
    const request = data[PENDING_LOCATE_KEY];

    if (!request?.text || !isSamePageUrl(request.pageUrl, location.href)) {
      return;
    }

    const located = locateAndHighlightText(request.text);
    if (located || Date.now() - Number(request.requestedAt || 0) > 15000) {
      await chrome.storage.local.remove(PENDING_LOCATE_KEY);
    }
  }

  function locateAndHighlightText(text) {
    const target = String(text || "").trim();
    if (!target) {
      return false;
    }

    const candidates = [
      target,
      target.replace(/\s+/g, " "),
      target.slice(0, 160),
      target.slice(0, 80)
    ].filter((value, index, list) => value.length >= 2 && list.indexOf(value) === index);

    for (const candidate of candidates) {
      if (findAndHighlightWithWindowFind(candidate)) {
        return true;
      }

      const range = findRangeInTextNodes(candidate);
      if (range && highlightRange(range)) {
        return true;
      }
    }

    showLocateToast("没有找到原文，可能页面内容已经变化。");
    return false;
  }

  function findAndHighlightWithWindowFind(text) {
    const selection = window.getSelection();
    selection?.removeAllRanges();

    const found = window.find(text, false, false, true, false, true, false);
    if (!found || !selection || selection.rangeCount === 0) {
      return false;
    }

    return highlightRange(selection.getRangeAt(0));
  }

  function findRangeInTextNodes(text) {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue?.trim()) {
            return NodeFilter.FILTER_REJECT;
          }

          if (host?.contains(node.parentElement)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      const index = node.nodeValue.indexOf(text);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + text.length);
        return range;
      }
    }

    return null;
  }

  function highlightRange(range) {
    try {
      injectLocateStyles();
      const mark = document.createElement("mark");
      mark.className = "daily-ai-located-note";
      mark.append(range.extractContents());
      range.insertNode(mark);
      mark.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      showLocateToast("已定位到加粗笔记原文。");
      return true;
    } catch {
      return false;
    }
  }

  function injectLocateStyles() {
    if (document.getElementById("daily-ai-locate-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "daily-ai-locate-style";
    style.textContent = `
      .daily-ai-located-note {
        background: linear-gradient(180deg, rgba(255, 232, 97, 0.55), rgba(255, 214, 10, 0.88));
        border-radius: 4px;
        box-shadow: 0 0 0 3px rgba(255, 214, 10, 0.45), 0 10px 24px rgba(120, 80, 0, 0.22);
        color: inherit;
        padding: 1px 2px;
        animation: dailyAiLocatePulse 1.2s ease-in-out 3;
      }

      .daily-ai-locate-toast {
        position: fixed;
        left: 50%;
        top: 24px;
        z-index: 2147483647;
        transform: translateX(-50%);
        padding: 10px 14px;
        border-radius: 999px;
        color: #1f2937;
        background: rgba(255, 255, 255, 0.9);
        box-shadow: 0 16px 48px rgba(15, 23, 42, 0.22);
        backdrop-filter: blur(18px) saturate(1.2);
        -webkit-backdrop-filter: blur(18px) saturate(1.2);
        font: 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
      }

      @keyframes dailyAiLocatePulse {
        0%, 100% { box-shadow: 0 0 0 3px rgba(255, 214, 10, 0.45), 0 10px 24px rgba(120, 80, 0, 0.22); }
        50% { box-shadow: 0 0 0 8px rgba(255, 214, 10, 0.28), 0 16px 36px rgba(120, 80, 0, 0.28); }
      }
    `;
    document.head.append(style);
  }

  function showLocateToast(message) {
    injectLocateStyles();
    document.querySelector(".daily-ai-locate-toast")?.remove();

    const toast = document.createElement("div");
    toast.className = "daily-ai-locate-toast";
    toast.textContent = message;
    document.documentElement.append(toast);
    window.setTimeout(() => toast.remove(), 2600);
  }

  function isSamePageUrl(left, right) {
    try {
      const leftUrl = new URL(left);
      const rightUrl = new URL(right);
      return (
        leftUrl.origin === rightUrl.origin &&
        leftUrl.pathname === rightUrl.pathname &&
        leftUrl.search === rightUrl.search
      );
    } catch {
      return left === right;
    }
  }

  function isEditableElement(element) {
    if (!element) {
      return false;
    }

    const tagName = element.tagName?.toLowerCase();
    return element.isContentEditable || tagName === "textarea" || tagName === "input";
  }

  function hideToolbar(shouldRender = true) {
    clearTimeout(selectionTimer);

    const toolbarExists = Boolean(shadow?.querySelector(".selection-toolbar"));

    if (!state.selectionText && !state.selectionRect && !toolbarExists) {
      return;
    }

    state = {
      ...state,
      selectionText: "",
      selectionRect: null
    };

    if (shouldRender) {
      render();
    }
  }

  function closePanel() {
    state = {
      ...state,
      isOpen: false
    };
    render();
  }

  function openSettings(focus) {
    chrome.runtime.sendMessage({
      type: "AI_CONTEXT_MENU_OPEN_OPTIONS",
      payload: focus ? { focus } : undefined
    });
  }

  async function copyOutput(text) {
    if (!text) {
      return;
    }

    await navigator.clipboard.writeText(text);
    const button = shadow.getElementById("copy-button");
    if (button) {
      button.textContent = "已复制";
      setTimeout(() => {
        button.textContent = "复制";
      }, 1200);
    }
  }

  function renderMarkdownLite(markdown) {
    const blocks = String(markdown)
      .trim()
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);

    if (blocks.length === 0) {
      return "<p>没有返回内容</p>";
    }

    return blocks
      .map((block) => {
        const lines = block.split("\n");
        const isList = lines.every((line) => /^[-*]\s+/.test(line.trim()));
        const isNumberedList = lines.every((line) => /^\d+[.)]\s+/.test(line.trim()));
        const isTable = lines.length > 1 && lines.every((line) => line.includes("|"));

        if (isTable) {
          return `<pre class="table-block">${escapeHtml(block)}</pre>`;
        }

        if (isList || isNumberedList) {
          const tag = isNumberedList ? "ol" : "ul";
          const items = lines
            .map((line) => `<li>${formatInline(line.replace(/^([-*]|\d+[.)])\s+/, ""))}</li>`)
            .join("");
          return `<${tag}>${items}</${tag}>`;
        }

        return `<p>${formatInline(block).replace(/\n/g, "<br>")}</p>`;
      })
      .join("");
  }

  function formatInline(text) {
    return escapeHtml(text)
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  function getStatusMeta(request) {
    if (request.status === "done") {
      return {
        className: "done",
        title: "完成",
        description:
          request.action === "translate" ? `已翻译为${request.targetLanguage || "目标语言"}。` : "结果已经生成，可以复制或切换其他动作。"
      };
    }

    if (request.status === "needs_api_key") {
      return {
        className: "warning",
        title: "需要 API Key",
        description: "这个动作需要先填写 API。加粗和加粗笔记不受影响，可以继续本地使用。"
      };
    }

    if (request.status === "error") {
      return {
        className: "error",
        title: "遇到问题",
        description: "通常是 API 密钥、模型名称或接口地址需要调整。"
      };
    }

    return {
      className: "loading",
      title: "处理中",
      description: request.action === "translate" ? `正在翻译为${request.targetLanguage || "目标语言"}。` : "正在处理选中的文字。"
    };
  }

  function getTargetLanguage(request) {
    const custom = shadow.getElementById("custom-language")?.value?.trim();
    const selected = shadow.getElementById("target-language")?.value;

    if (selected === "__custom__") {
      return custom || request.targetLanguage || "中文";
    }

    return selected || request.targetLanguage || "中文";
  }

  function getActionMark(actionId) {
    const marks = {
      translate: "译",
      summarize: "Σ",
      explain: "?",
      bold: "B",
      polish: "✎"
    };

    return marks[actionId] || "AI";
  }

  function formatTextLength(text) {
    return `${String(text || "").length} 字符`;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getStyles() {
    return `
      :host {
        all: initial;
        color-scheme: light;
        --window: rgba(248, 249, 252, 0.9);
        --panel: rgba(255, 255, 255, 0.8);
        --ink: #1f2937;
        --muted: #6b7280;
        --blue: #0a84ff;
        --green: #32d74b;
        --yellow: #ffd60a;
        --red: #ff453a;
        --shadow: 0 26px 90px rgba(15, 23, 42, 0.24);
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", sans-serif;
      }

      * { box-sizing: border-box; }
      button, input, select { font: inherit; }
      button { border: 0; cursor: pointer; }

      .selection-toolbar {
        position: fixed;
        z-index: 2147483647;
        width: 344px;
        min-height: 44px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px;
        border: 1px solid rgba(255,255,255,.76);
        border-radius: 999px;
        color: var(--ink);
        background: linear-gradient(180deg, rgba(255,255,255,.84), rgba(245,246,249,.74));
        box-shadow: 0 16px 48px rgba(15,23,42,.22);
        backdrop-filter: blur(22px) saturate(1.25);
        -webkit-backdrop-filter: blur(22px) saturate(1.25);
        animation: toolbarIn 150ms cubic-bezier(.2,.8,.2,1);
      }

      .selection-toolbar button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 32px;
        border-radius: 999px;
        white-space: nowrap;
      }

      .toolbar-main {
        min-width: 88px;
        padding: 0 12px;
        color: #fff;
        background: linear-gradient(135deg, #0a84ff, #64d2ff);
        box-shadow: 0 10px 20px rgba(10,132,255,.24);
      }

      .toolbar-main span,
      .toolbar-action span {
        font-size: 12px;
        font-weight: 900;
      }

      .toolbar-main strong {
        font-size: 13px;
        font-weight: 850;
      }

      .toolbar-divider {
        width: 1px;
        height: 22px;
        background: rgba(31,41,55,.12);
      }

      .toolbar-action {
        min-width: 54px;
        padding: 0 8px;
        color: var(--ink);
        background: transparent;
      }

      .toolbar-action:hover {
        background: rgba(255,255,255,.72);
      }

      .toolbar-action span {
        color: var(--blue);
      }

      .toolbar-action small {
        color: rgba(31,41,55,.76);
        font-size: 12px;
        font-weight: 760;
      }

      .toolbar-close {
        width: 30px;
        min-width: 30px;
        padding: 0;
        color: rgba(31,41,55,.58);
        background: rgba(255,255,255,.52);
        box-shadow: inset 0 0 0 1px rgba(31,41,55,.08);
        font-size: 18px;
        line-height: 1;
      }

      .toolbar-close:hover {
        color: #fff;
        background: var(--red);
      }

      .mac-window {
        position: fixed;
        top: 18px;
        right: 18px;
        z-index: 2147483647;
        width: min(440px, calc(100vw - 24px));
        max-height: calc(100vh - 36px);
        display: grid;
        grid-template-rows: auto auto auto auto auto minmax(0, 1fr);
        overflow: hidden;
        color: var(--ink);
        background: linear-gradient(180deg, rgba(255,255,255,.72), rgba(248,249,252,.9)), var(--window);
        border: 1px solid rgba(255,255,255,.82);
        border-radius: 18px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(26px) saturate(1.25);
        -webkit-backdrop-filter: blur(26px) saturate(1.25);
        transform: translateX(calc(100% + 28px)) scale(.98);
        opacity: 0;
        transition: transform 220ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease;
      }

      .mac-window.open { transform: translateX(0) scale(1); opacity: 1; }

      .titlebar {
        height: 42px;
        display: grid;
        grid-template-columns: 82px 1fr 82px;
        align-items: center;
        padding: 0 12px;
        border-bottom: 1px solid rgba(31,41,55,.08);
        background: rgba(245,246,249,.7);
      }

      .traffic { display: flex; align-items: center; gap: 8px; }
      .dot { width: 12px; height: 12px; display: block; border-radius: 999px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
      .close-dot { background: var(--red); }
      .min-dot { background: var(--yellow); }
      .max-dot { background: var(--green); }

      .window-title {
        overflow: hidden;
        color: rgba(31,41,55,.72);
        font-size: 13px;
        font-weight: 700;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .settings-button {
        justify-self: end;
        min-height: 26px;
        padding: 0 10px;
        border-radius: 999px;
        color: var(--muted);
        background: rgba(255,255,255,.58);
        box-shadow: inset 0 0 0 1px rgba(31,41,55,.08);
        font-size: 12px;
        font-weight: 700;
      }

      .hero { display: flex; gap: 12px; align-items: center; padding: 16px 16px 10px; }
      .app-icon {
        width: 46px;
        height: 46px;
        flex: 0 0 46px;
        display: grid;
        place-items: center;
        border-radius: 13px;
        color: #fff;
        background: linear-gradient(135deg, rgba(255,255,255,.22), transparent 42%), linear-gradient(135deg, #0a84ff, #64d2ff);
        box-shadow: 0 14px 26px rgba(10,132,255,.28);
        font-size: 15px;
        font-weight: 900;
      }

      .hero-copy { min-width: 0; }
      .hero-copy p, .hero-copy h2 { margin: 0; }
      .hero-copy p { color: var(--muted); font-size: 12px; font-weight: 700; }
      .hero-copy h2 { margin-top: 3px; color: var(--ink); font-size: 20px; line-height: 1.2; }

      .quick-actions { display: flex; gap: 8px; overflow-x: auto; padding: 4px 16px 12px; scrollbar-width: none; }
      .quick-actions::-webkit-scrollbar { display: none; }

      .action-pill {
        flex: 0 0 auto;
        min-height: 30px;
        padding: 0 12px;
        border-radius: 999px;
        color: var(--ink);
        background: rgba(255,255,255,.7);
        box-shadow: inset 0 0 0 1px rgba(31,41,55,.09);
        font-size: 13px;
        font-weight: 700;
      }

      .action-pill.active { color: #fff; background: linear-gradient(135deg, #0a84ff, #64d2ff); box-shadow: 0 10px 20px rgba(10,132,255,.22); }
      .action-pill:disabled, .copy-button:disabled, .custom-target button:disabled { cursor: not-allowed; opacity: .5; }

      .translation-tools, .status-line {
        margin: 0 16px 12px;
        border-radius: 14px;
        background: rgba(255,255,255,.58);
        box-shadow: inset 0 0 0 1px rgba(31,41,55,.08);
      }

      .translation-tools { display: grid; gap: 8px; padding: 10px; }
      .translation-tools label { display: grid; grid-template-columns: 72px 1fr; gap: 10px; align-items: center; }
      .translation-tools span { color: var(--muted); font-size: 12px; font-weight: 800; }

      select, input {
        width: 100%;
        min-height: 32px;
        border: 1px solid rgba(31,41,55,.12);
        border-radius: 10px;
        outline: none;
        color: var(--ink);
        background: rgba(255,255,255,.78);
      }

      select { padding: 0 10px; }
      input { padding: 0 11px; }
      select:focus, input:focus { border-color: rgba(10,132,255,.58); box-shadow: 0 0 0 3px rgba(10,132,255,.12); }
      .custom-target { display: grid; grid-template-columns: 1fr 62px; gap: 8px; }
      .custom-target button, .copy-button { min-height: 32px; border-radius: 10px; color: #fff; background: #0a84ff; font-size: 13px; font-weight: 800; }

      .status-line { display: flex; gap: 8px; align-items: center; padding: 9px 10px; }
      .status-line span { width: 8px; height: 8px; flex: 0 0 8px; border-radius: 999px; background: var(--blue); }
      .status-line.loading span { animation: breathe 900ms ease-in-out infinite; }
      .status-line.done span { background: var(--green); }
      .status-line.warning span { background: var(--yellow); }
      .status-line.error span { background: var(--red); }
      .status-line p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.45; }

      .content-area { min-height: 0; display: grid; gap: 12px; overflow: auto; padding: 0 16px 16px; }
      .source, .answer { border-radius: 14px; background: var(--panel); box-shadow: inset 0 0 0 1px rgba(31,41,55,.08); }
      .source summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 12px; color: var(--ink); list-style: none; cursor: pointer; font-size: 13px; font-weight: 800; }
      .source summary::-webkit-details-marker { display: none; }
      .source small { color: var(--muted); font-size: 12px; font-weight: 600; }
      .source-text { max-height: 118px; overflow: auto; padding: 0 12px 12px; color: rgba(31,41,55,.78); font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
      .answer { min-height: 220px; overflow: hidden; }
      .answer-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 12px; border-bottom: 1px solid rgba(31,41,55,.08); font-size: 13px; font-weight: 800; }
      .copy-button { min-height: 26px; min-width: 54px; padding: 0 10px; border-radius: 999px; font-size: 12px; }
      .answer-body { max-height: min(48vh, 520px); overflow: auto; padding: 13px 14px; color: var(--ink); font-size: 14px; line-height: 1.7; }
      .markdown p { margin: 0 0 11px; }
      .markdown p:last-child { margin-bottom: 0; }
      .markdown ul, .markdown ol { margin: 0 0 11px; padding-left: 20px; }
      .markdown li { margin: 4px 0; }
      .markdown code { padding: 2px 5px; border-radius: 6px; background: rgba(10,132,255,.1); color: #075aa8; font-family: "SF Mono", "Cascadia Code", Consolas, monospace; font-size: .92em; }
      .table-block, .error-text { margin: 0; white-space: pre-wrap; word-break: break-word; font: inherit; }
      .error-text { color: #b42318; }
      .api-key-card {
        min-height: 176px;
        display: grid;
        align-content: center;
        justify-items: start;
        gap: 10px;
        padding: 8px 2px;
      }
      .api-key-card strong {
        color: var(--ink);
        font-size: 16px;
      }
      .api-key-card p {
        margin: 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.7;
      }
      .api-key-card button {
        min-height: 34px;
        padding: 0 14px;
        border-radius: 999px;
        color: #fff;
        background: linear-gradient(135deg, var(--blue), #64d2ff);
        box-shadow: 0 10px 22px rgba(10,132,255,.22);
        font-weight: 850;
      }
      .destination-picker {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        padding: 18px;
        background: rgba(15, 23, 42, 0.16);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .destination-sheet {
        width: min(360px, calc(100vw - 32px));
        padding: 14px;
        border: 1px solid rgba(255,255,255,.8);
        border-radius: 18px;
        color: var(--ink);
        background: linear-gradient(180deg, rgba(255,255,255,.86), rgba(248,249,252,.92));
        box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
        animation: pickerIn 160ms cubic-bezier(.2,.8,.2,1);
      }
      .destination-sheet-head {
        display: flex;
        gap: 10px;
        align-items: center;
        margin-bottom: 12px;
      }
      .destination-sheet-head > span {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border-radius: 10px;
        color: #fff;
        background: linear-gradient(135deg, #0a84ff, #64d2ff);
        font-weight: 900;
      }
      .destination-sheet-head strong,
      .destination-sheet-head p {
        display: block;
        margin: 0;
      }
      .destination-sheet-head strong {
        font-size: 15px;
      }
      .destination-sheet-head p {
        margin-top: 2px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
      }
      .destination-options {
        display: grid;
        gap: 8px;
      }
      .destination-options button {
        min-height: 52px;
        display: grid;
        justify-items: start;
        gap: 2px;
        padding: 9px 11px;
        border-radius: 13px;
        color: var(--ink);
        background: rgba(255,255,255,.72);
        box-shadow: inset 0 0 0 1px rgba(31,41,55,.09);
        text-align: left;
      }
      .destination-options button:hover {
        background: rgba(10,132,255,.1);
        box-shadow: inset 0 0 0 1px rgba(10,132,255,.22);
      }
      .destination-options strong {
        max-width: 100%;
        overflow: hidden;
        font-size: 13px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .destination-options small {
        max-width: 100%;
        overflow: hidden;
        color: var(--muted);
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .destination-sheet-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 10px;
      }
      .destination-cancel {
        min-height: 30px;
        padding: 0 12px;
        border-radius: 999px;
        color: var(--muted);
        background: rgba(255,255,255,.62);
        box-shadow: inset 0 0 0 1px rgba(31,41,55,.08);
        font-size: 12px;
        font-weight: 800;
      }
      .loading-card { min-height: 160px; display: grid; place-items: center; align-content: center; gap: 14px; color: var(--muted); }
      .loader { display: flex; gap: 7px; }
      .loader span { width: 9px; height: 9px; border-radius: 999px; background: var(--blue); animation: bounce 900ms ease-in-out infinite; }
      .loader span:nth-child(2) { animation-delay: 120ms; }
      .loader span:nth-child(3) { animation-delay: 240ms; }
      .loading-card p { margin: 0; font-size: 13px; }

      @keyframes toolbarIn {
        from { transform: translateY(4px) scale(.98); opacity: 0; }
        to { transform: translateY(0) scale(1); opacity: 1; }
      }

      @keyframes breathe {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(.65); opacity: .55; }
      }

      @keyframes bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
      }

      @keyframes pickerIn {
        from { transform: translateY(8px) scale(.98); opacity: 0; }
        to { transform: translateY(0) scale(1); opacity: 1; }
      }

      @media (max-width: 520px) {
        .selection-toolbar { width: min(344px, calc(100vw - 20px)); }
        .mac-window { inset: auto 10px 10px 10px; width: auto; max-height: calc(100vh - 20px); }
        .titlebar { grid-template-columns: 76px 1fr 70px; }
      }
    `;
  }
})();
