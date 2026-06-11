const DEFAULT_SETTINGS = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4.1-mini",
  systemPrompt:
    "你是一个嵌入 Chrome 扩展里的日常网页 AI 助手。请用中文清楚、简洁、实用地回答，必要时保留 Markdown 结构。",
  temperature: 0.3
};

const ACTIONS = [
  {
    id: "translate",
    title: "翻译",
    menuTitle: "翻译选中文本",
    prompt: (options) => [
      "请自动识别原文语言，并翻译成目标语言。",
      `目标语言：${options.targetLanguage || "中文"}`,
      "要求：保留原意、语气、术语和格式；只输出译文，不解释翻译过程。"
    ].join("\n")
  },
  {
    id: "summarize",
    title: "总结",
    menuTitle: "总结选中文本",
    prompt: () => [
      "请总结选中的内容。",
      "输出结构：",
      "1. 一句话概括",
      "2. 关键要点",
      "3. 值得记住的信息"
    ].join("\n")
  },
  {
    id: "explain",
    title: "解释",
    menuTitle: "解释一下",
    prompt: () => [
      "请用简单易懂的方式解释选中的内容。",
      "如果有术语、背景或隐含含义，请顺手说明。"
    ].join("\n")
  },
  {
    id: "bold",
    title: "加粗",
    menuTitle: "加粗选中文字",
    localOnly: true,
    prompt: () => ""
  },
  {
    id: "polish",
    title: "润色",
    menuTitle: "润色改写",
    prompt: () => [
      "请在不改变原意的前提下润色选中的内容。",
      "让表达更自然、清楚、礼貌；如果原文很口语，请给出更适合发送的版本。"
    ].join("\n")
  }
];

const TARGET_LANGUAGES = ["中文", "英语", "日语", "韩语", "法语", "德语", "西班牙语", "繁体中文"];

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const nextSettings = {};

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing[key] === undefined) {
      nextSettings[key] = value;
    }
  }

  if (Object.keys(nextSettings).length > 0) {
    await chrome.storage.sync.set(nextSettings);
  }

  await ensureContextMenus();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureContextMenus();
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.menuItemId || !info.selectionText || !tab?.id) {
    return;
  }

  await runActionInTab({
    tab,
    actionId: String(info.menuItemId),
    selectedText: info.selectionText,
    targetLanguage: "中文"
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "AI_CONTEXT_MENU_OPEN_OPTIONS") {
    openOptionsPage(message.payload?.focus);
    return;
  }

  if (message?.type !== "AI_CONTEXT_MENU_RUN_ACTION" || !sender.tab?.id) {
    return;
  }

  runActionInTab({
    tab: sender.tab,
    actionId: message.payload?.actionId,
    selectedText: message.payload?.input,
    targetLanguage: message.payload?.targetLanguage
  }).catch((error) => {
    console.error("Failed to run AI action:", error);
  });
});

async function ensureContextMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "ai-root",
    title: "日常 AI 助手",
    contexts: ["selection"]
  });

  for (const action of ACTIONS) {
    chrome.contextMenus.create({
      id: action.id,
      parentId: "ai-root",
      title: action.menuTitle,
      contexts: ["selection"]
    });
  }
}

function openOptionsPage(focus) {
  if (focus === "apiKey") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html#apiKey") });
    return;
  }

  chrome.runtime.openOptionsPage();
}

async function runActionInTab({ tab, actionId, selectedText, targetLanguage = "中文" }) {
  const action = ACTIONS.find((entry) => entry.id === actionId);
  const input = String(selectedText || "").trim();
  const normalizedTargetLanguage = String(targetLanguage || "中文").trim() || "中文";

  if (!action || !input || !tab?.id) {
    return;
  }

  if (action.localOnly) {
    await sendPanelMessage(tab.id, {
      type: "AI_CONTEXT_MENU_LOCAL_ACTION",
      payload: {
        action: action.id,
        input
      }
    });
    return;
  }

  const request = {
    id: crypto.randomUUID(),
    status: "loading",
    createdAt: Date.now(),
    action: action.id,
    actionTitle: action.title,
    actions: ACTIONS.map(({ id, title }) => ({ id, title })),
    input,
    output: "",
    error: "",
    pageTitle: tab.title || "",
    pageUrl: tab.url || "",
    targetLanguage: normalizedTargetLanguage,
    targetLanguages: TARGET_LANGUAGES
  };

  const config = await getNormalizedConfig();

  if (!config.apiKey) {
    await sendPanelMessage(tab.id, {
      type: "AI_CONTEXT_MENU_RESULT",
      payload: {
        ...request,
        status: "needs_api_key"
      }
    });
    return;
  }

  await sendPanelMessage(tab.id, {
    type: "AI_CONTEXT_MENU_REQUEST",
    payload: request
  });

  try {
    const output = await runAiAction(action, input, {
      tab,
      targetLanguage: normalizedTargetLanguage,
      config
    });

    await sendPanelMessage(tab.id, {
      type: "AI_CONTEXT_MENU_RESULT",
      payload: {
        ...request,
        status: "done",
        output
      }
    });
  } catch (error) {
    await sendPanelMessage(tab.id, {
      type: "AI_CONTEXT_MENU_RESULT",
      payload: {
        ...request,
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      }
    });
  }
}

async function getNormalizedConfig() {
  const settings = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  return normalizeConfig({ ...DEFAULT_SETTINGS, ...settings });
}

async function runAiAction(action, selectedText, options) {
  const config = options?.config || (await getNormalizedConfig());

  if (!config.apiKey) {
    throw new Error("还没有填写 API 密钥。请点击扩展图标打开设置页。");
  }

  const response = await fetch(config.baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      messages: [
        {
          role: "system",
          content: config.systemPrompt
        },
        {
          role: "user",
          content: [
            action.prompt(options),
            "",
            `页面标题：${options.tab?.title || "未知"}`,
            `页面地址：${options.tab?.url || "未知"}`,
            "",
            "选中的内容：",
            selectedText
          ].join("\n")
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await safeReadText(response);
    throw new Error(`API 请求失败：${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content || typeof content !== "string") {
    throw new Error("模型没有返回可显示的文本内容。");
  }

  return content.trim();
}

async function safeReadText(response) {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

function normalizeConfig(config) {
  return {
    apiKey: String(config.apiKey || "").trim(),
    baseUrl: String(config.baseUrl || DEFAULT_SETTINGS.baseUrl).trim() || DEFAULT_SETTINGS.baseUrl,
    model: String(config.model || DEFAULT_SETTINGS.model).trim() || DEFAULT_SETTINGS.model,
    systemPrompt:
      String(config.systemPrompt || DEFAULT_SETTINGS.systemPrompt).trim() || DEFAULT_SETTINGS.systemPrompt,
    temperature: Number.isFinite(Number(config.temperature))
      ? Math.max(0, Math.min(2, Number(config.temperature)))
      : DEFAULT_SETTINGS.temperature
  };
}

async function sendPanelMessage(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    await chrome.tabs.sendMessage(tabId, message);
  }
}
