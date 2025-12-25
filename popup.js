// popup.js
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  const apiUrl = $("apiUrl");
  const apiKey = $("apiKey");
  const modelName = $("modelName");
  const systemPrompt = $("systemPrompt");
  const btn = $("toggleBtn");
  const badge = $("badge");
  const count = $("count");
  const err = $("error");

  // --- 1. 加载数据 ---
  const data = await chrome.storage.local.get([
    "apiUrl", "apiKey", "modelName", "systemPrompt", "isRunning", "totalReplies"
  ]);

  apiUrl.value = data.apiUrl || "https://api.openai.com/v1";
  apiKey.value = data.apiKey || "";
  modelName.value = data.modelName || "gpt-4o";
  systemPrompt.value = data.systemPrompt || "你是一个真实网友，用简短自然的语气发表评论，8-20词，0-2个emoji。";
  
  count.textContent = String(data.totalReplies || 0);
  setUI(!!data.isRunning);

  // --- 2. 按钮点击逻辑 ---
  btn.addEventListener("click", async () => {
    err.style.display = "none";
    err.textContent = "";

    // 获取当前状态
    const currentData = await chrome.storage.local.get(["isRunning"]);
    const willRun = !currentData.isRunning; // 切换后的目标状态

    // 保存配置
    const config = {
      isRunning: willRun, // 关键：先保存状态
      apiUrl: apiUrl.value.trim(),
      apiKey: apiKey.value.trim(),
      modelName: (modelName.value.trim() || "gpt-3.5-turbo").trim(),
      systemPrompt: systemPrompt.value.trim()
    };

    if (willRun) {
      // === 启动流程 (Auto Refresh) ===
      config.totalReplies = 0; // 重置计数
      await chrome.storage.local.set(config);
      
      // 更新 UI
      count.textContent = "0";
      setUI(true);

      // 获取当前标签页并刷新
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab && (tab.url.includes("x.com") || tab.url.includes("twitter.com"))) {
            // 刷新页面。页面加载后 content.js 会读取 isRunning=true 并自动开始
            chrome.tabs.reload(tab.id);
            // 可选：给用户一点反馈，因为 reload 可能导致 popup 关闭
            btn.textContent = "正在刷新并启动...";
        } else {
            showErr("请在 X/Twitter 页面操作");
            // 回滚状态
            chrome.storage.local.set({ isRunning: false });
            setUI(false);
        }
      });

    } else {
      // === 停止流程 (Hard Stop) ===
      await chrome.storage.local.set(config);
      setUI(false);

      // 发送停止信号给 content script (不刷新)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
              chrome.tabs.sendMessage(tabs[0].id, { 
                  type: "STATE_CHANGE", 
                  payload: { isRunning: false } 
              }).catch(() => {
                  // 如果消息发送失败（例如页面还没加载完），也没关系，storage 已经设为 false 了
              });
          }
      });
    }
  });

  // --- 监听计数更新 ---
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "UPDATE_COUNT") {
      count.textContent = String(msg?.payload?.count ?? 0);
    }
  });

  function setUI(isRunning) {
    if (isRunning) {
      badge.textContent = "运行中";
      badge.className = "badge running";
      btn.textContent = "停止";
      btn.classList.add("stop");
    } else {
      badge.textContent = "已停止";
      badge.className = "badge stopped";
      btn.textContent = "启动";
      btn.classList.remove("stop");
    }
  }

  function showErr(t) {
    err.textContent = t;
    err.style.display = "block";
  }
});