// background.js

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  // 1. Content 脚本加载完毕后的握手（虽然现在自动刷新，保留此逻辑无害）
  if (req?.type === "CONTENT_READY") {
    sendResponse({ ok: true });
    return true;
  }

  // 2. AI 调用接口
  if (req?.type === "CALL_AI_API") {
    (async () => {
      try {
        const resp = await handleOpenAI(req.payload || {});
        sendResponse(resp);
      } catch (e) {
        sendResponse({ success: false, error: String(e?.message || e) });
      }
    })();
    return true; // 保持异步通道开启
  }

  // 3. 计数更新转发（如果 popup 关闭了，消息发给 background 也没事）
  if (req?.type === "UPDATE_COUNT") {
      // 可以选择在此处做徽章更新 (Badge Text)
      // chrome.action.setBadgeText({ text: String(req.payload.count) });
      sendResponse({ ok: true });
  }

  return true;
});

// 处理 API 请求的工具函数
function normalizeEndpoint(apiUrl) {
  let base = String(apiUrl || "").trim();
  if (!base) base = "https://api.openai.com/v1";
  base = base.replace(/\/+$/, "");
  if (!base.includes("/v1")) base += "/v1";
  if (!base.endsWith("/chat/completions")) base += "/chat/completions";
  return base;
}

async function handleOpenAI({ apiUrl, apiKey, model, messages }) {
  if (!apiKey) return { success: false, error: "API Key 为空" };
  const endpoint = normalizeEndpoint(apiUrl);
  
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || "gpt-3.5-turbo",
        messages: messages || [],
        temperature: 0.8,
        max_tokens: 150
      })
    });

    const raw = await r.text();
    if (!r.ok) return { success: false, error: `API Error ${r.status}` };

    const data = JSON.parse(raw);
    const text = data?.choices?.[0]?.message?.content?.trim();
    
    // 简单的清理
    const cleaned = text ? text.replace(/^["“”]+|["“”]+$/g, "") : "";
    return { success: true, reply: cleaned || "Error: No content" };

  } catch (e) {
    return { success: false, error: e.message };
  }
}