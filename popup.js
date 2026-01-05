// popup.js
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  const apiUrl = $("apiUrl");
  const apiKey = $("apiKey");
  const modelSelect = $("modelSelect");
  const modelNameInput = $("modelName"); // 隐藏的文本框
  const systemPrompt = $("systemPrompt");
  const btn = $("toggleBtn");
  const badge = $("badge");
  const count = $("count"); // 评论数
  const likeCount = $("likeCount"); // 点赞数
  const err = $("error");

  // --- 1. 加载数据 ---
  const data = await chrome.storage.local.get([
    "apiUrl", "apiKey", "modelName", "systemPrompt", 
    "isRunning", "totalReplies", "totalLikes"
  ]);

  apiUrl.value = data.apiUrl || "https://api.openai.com/v1";
  apiKey.value = data.apiKey || "";
  systemPrompt.value = data.systemPrompt || "你是一个真实网友，用简短自然的语气发表评论，8-20词，0-2个emoji。";
  
  count.textContent = String(data.totalReplies || 0);
  likeCount.textContent = String(data.totalLikes || 0);

  // --- 模型选择逻辑初始化 ---
  const savedModel = data.modelName || "gpt-4o";
  
  // 检查保存的模型是否在下拉列表中
  const options = Array.from(modelSelect.options).map(o => o.value);
  if (options.includes(savedModel)) {
      modelSelect.value = savedModel;
      modelNameInput.classList.add('hidden');
  } else {
      modelSelect.value = "custom";
      modelNameInput.value = savedModel;
      modelNameInput.classList.remove('hidden');
  }

  // 模型实际使用的值（用于保存）
  const getFinalModelName = () => {
      if (modelSelect.value === "custom") {
          return modelNameInput.value.trim();
      }
      return modelSelect.value;
  };

  setUI(!!data.isRunning);

  // --- 2. 事件监听 ---
  
  // 下拉菜单变化时
  modelSelect.addEventListener("change", () => {
      if (modelSelect.value === "custom") {
          modelNameInput.classList.remove('hidden');
          modelNameInput.focus();
      } else {
          modelNameInput.classList.add('hidden');
      }
  });

  btn.addEventListener("click", async () => {
    err.style.display = "none";
    err.textContent = "";

    const currentData = await chrome.storage.local.get(["isRunning"]);
    const willRun = !currentData.isRunning;
    const finalModel = getFinalModelName();

    if (!finalModel) {
        showErr("请选择或输入模型名称");
        return;
    }

    const config = {
      apiUrl: apiUrl.value.trim(),
      apiKey: apiKey.value.trim(),
      modelName: finalModel,
      systemPrompt: systemPrompt.value.trim(),
      isRunning: willRun
    };

    if (willRun && !config.apiKey) {
      showErr("请输入 API Key");
      return;
    }

    // 保存配置
    await chrome.storage.local.set(config);
    setUI(willRun);

    if (willRun) {
      // === 启动流程 ===
      // 查询当前标签页
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return showErr("无法获取当前标签页");
        const url = tabs[0].url || "";
        if (url.includes("x.com") || url.includes("twitter.com")) {
            // 发送消息，如果失败（content script 未加载），则刷新页面
            chrome.tabs.sendMessage(tabs[0].id, { 
                type: "STATE_CHANGE", 
                payload: { isRunning: true } 
            }).catch(() => {
                chrome.tabs.reload(tabs[0].id);
            });
            btn.textContent = "正在启动...";
        } else {
            showErr("请在 X/Twitter 页面操作");
            chrome.storage.local.set({ isRunning: false });
            setUI(false);
        }
      });
    } else {
      // === 停止流程 ===
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
              chrome.tabs.sendMessage(tabs[0].id, { 
                  type: "STATE_CHANGE", 
                  payload: { isRunning: false } 
              }).catch(()=>{});
          }
      });
    }
  });

  // --- 监听计数更新 (评论 和 点赞) ---
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "UPDATE_COUNT") {
      count.textContent = String(msg?.payload?.count ?? 0);
    }
    if (msg?.type === "UPDATE_LIKES") {
      likeCount.textContent = String(msg?.payload?.count ?? 0);
    }
  });

  function setUI(isRunning) {
    if (isRunning) {
      badge.textContent = "运行中";
      badge.className = "badge running";
      btn.textContent = "停止";
      btn.className = "stop";
      // 运行时禁用输入，防止中途修改参数
      apiUrl.disabled = true;
      apiKey.disabled = true;
      modelSelect.disabled = true;
      modelNameInput.disabled = true;
      systemPrompt.disabled = true;
    } else {
      badge.textContent = "已停止";
      badge.className = "badge stopped";
      btn.textContent = "启动";
      btn.className = "";
      apiUrl.disabled = false;
      apiKey.disabled = false;
      modelSelect.disabled = false;
      modelNameInput.disabled = false;
      systemPrompt.disabled = false;
    }
  }

  function showErr(msg) {
    err.textContent = msg;
    err.style.display = "block";
  }
});