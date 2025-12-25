// content.js

// --- 全局状态 ---
let isRunning = false;
let processedTweetIds = new Set(); // 仍然需要记录已处理ID，防止重复回复同一条
let isProcessingReply = false;

const AI_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/><path d="M12 6a1 1 0 0 0-1 1v2H9a1 1 0 0 0 0 2h2v2a1 1 0 0 0 2 0v-2h2a1 1 0 0 0 0-2h-2V7a1 1 0 0 0-1-1z"/></svg>`;

// --- 初始化 ---

// 1. 握手
chrome.runtime.sendMessage({ type: "CONTENT_READY" });

// 2. 检查自动运行状态 (页面刷新后)
chrome.storage.local.get(['isRunning'], (data) => {
  if (data.isRunning) {
    // 页面刚刷新，给一点时间让推特加载内容
    setTimeout(startAutomation, 3000);
  }
});

// 3. 监听消息
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.type === "STATE_CHANGE") {
    if (req.payload.isRunning) startAutomation();
    else stopAutomation();
  }
  return true;
});

// --- 自动化主循环 (核心改变) ---

async function startAutomation() {
  if (isRunning) return;
  isRunning = true;
  console.log("AI 助手：开始运行 (即时模式)...");
  
  // 开始无限循环
  automationLoop();
}

function stopAutomation() {
  isRunning = false;
  console.log("AI 助手：停止运行");
}

async function automationLoop() {
  while (isRunning) {
    // 1. 在当前视图中寻找一个可回复的推文
    const candidate = findBestCandidate();

    if (candidate) {
      // 2. 如果找到了，执行回复流程 (这里面包含了 2-3 分钟的等待)
      await triggerAutoReply(candidate);
    } else {
      // 3. 如果当前屏幕没有合适的 (全是广告 or 已回复)，小幅度滚动寻找
      console.log("当前屏幕无合适推文，向下搜寻...");
      window.scrollBy({ top: 300, behavior: 'smooth' });
      await randomDelay(2000, 3000); // 等待滚动加载
    }
    
    // 这里的循环不需要额外的 sleep，因为 triggerAutoReply 内部有长等待，
    // 或者 else 分支有短等待。
  }
}

// --- 寻找合适的推文 ---

function findBestCandidate() {
  // 获取当前页面所有推文
  const allTweets = document.querySelectorAll('article[data-testid="tweet"]');
  
  for (let tweet of allTweets) {
    // 1. 基础检查：是否已处理、是否可见
    if (!isInViewport(tweet)) continue; // 只处理视口内的，模拟人类浏览
    
    const id = getTweetId(tweet);
    if (!id || processedTweetIds.has(id)) continue;

    // 2. 内容过滤
    const text = tweet.innerText;
    if (text.includes("Ad") || text.includes("Promoted") || text.includes("广告")) continue;
    
    // 3. 排除主贴 (如果是详情页)
    if (isMainTweet(tweet)) {
        processedTweetIds.add(id); // 标记主贴已读，但不回复
        continue; 
    }

    // 找到第一个符合条件的，立即返回
    return tweet;
  }
  return null;
}

// 检查元素是否在视口内 (或者接近视口)
function isInViewport(el) {
    const rect = el.getBoundingClientRect();
    // 只要头部在屏幕下方 1/3 处以上，且没有滚出屏幕上方太多
    return (
        rect.top >= -200 && 
        rect.top <= (window.innerHeight || document.documentElement.clientHeight)
    );
}

// --- 自动化执行流程 ---

async function triggerAutoReply(tweetElement) {
  if (!isRunning) return;
  isProcessingReply = true;

  const tweetId = getTweetId(tweetElement);
  processedTweetIds.add(tweetId); // 立即标记，防止重复

  try {
    // 1. 滚动到该元素 (对齐)
    tweetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await randomDelay(1500, 2500);
    if (!isRunning) return;

    // 2. 获取文本
    const textNode = tweetElement.querySelector('div[data-testid="tweetText"]');
    const tweetText = textNode ? textNode.innerText : "";
    if (!tweetText) {
        console.log("推文无文本，跳过");
        return;
    }

    console.log(`正在处理: ${tweetText.slice(0, 20)}...`);

    // 3. AI 生成
    const replyText = await generateReplyFromAI(tweetText);
    if (!isRunning) return;
    console.log(`AI 回复: ${replyText}`);

    // 4. 打开回复框
    const replyButton = tweetElement.querySelector('button[data-testid="reply"]');
    if (!replyButton) throw new Error("无回复按钮");
    replyButton.click();

    // 5. 等待输入框
    const inputBox = await waitForElement('div[role="dialog"] div[role="textbox"]', 5000);
    if (!inputBox) throw new Error("输入框未出现");
    if (!isRunning) { closeDialog(); return; }

    // 6. 输入与发送
    await simulateReactInput(inputBox, replyText);
    await randomDelay(1000, 2000);
    if (!isRunning) { closeDialog(); return; }

    const sent = await clickSendButton();

    if (sent) {
        updateCount(1);
        console.log("✅ 发送成功");
        await randomDelay(3000, 5000);
        window.scrollBy({ top: 1200, behavior: 'smooth' });

        // --- 核心等待：2-3 分钟 ---
        console.log("⏳ 进入冷却：等待 2-3 分钟...");
        // 120秒 ~ 180秒
        await randomDelay(120 * 1000, 180 * 1000);
        window.scrollBy({ top: 600, behavior: 'smooth' });
        
        // 冷却结束后，大幅滚动一次，准备寻找下一个
        if (isRunning) {
            console.log("🔄 冷却结束，翻页寻找新内容...");
            
            await randomDelay(2000, 3000);
            window.scrollBy({ top: 600, behavior: 'smooth' });
        }
    } else {
        closeDialog();
    }

  } catch (e) {
    console.error("处理失败:", e.message);
    closeDialog();
    // 失败了也要稍微滚一下，防止卡死在这个位置
    window.scrollBy({ top: 100, behavior: 'smooth' });
  } finally {
    isProcessingReply = false;
  }
}

// --- AI 接口 (不变) ---
async function generateReplyFromAI(tweetText) {
    const config = await chrome.storage.local.get(['apiKey', 'apiUrl', 'modelName', 'systemPrompt']);
    if (!config.apiKey) throw new Error("未配置 API Key");

    const messages = [
        { role: "system", content: config.systemPrompt || "You are a helpful assistant." },
        { role: "user", content: `Reply to this tweet: "${tweetText}"` }
    ];

    const response = await chrome.runtime.sendMessage({
        type: "CALL_AI_API",
        payload: {
            apiKey: config.apiKey,
            apiUrl: config.apiUrl,
            model: config.modelName,
            messages: messages
        }
    });

    if (!response || !response.success) {
        throw new Error(response?.error || "AI Error");
    }
    return response.reply;
}

// --- 辅助工具函数 ---

function getTweetId(tweetElement) {
  const link = tweetElement.querySelector('a[href*="/status/"]');
  if (link) {
    const parts = link.href.split('/status/');
    if (parts.length > 1) return parts[1].split('/')[0];
  }
  return null;
}

function isMainTweet(tweetElement) {
    const pathname = window.location.pathname;
    if (pathname === '/' || pathname === '/home') return false; 
    const tweetUrl = tweetElement.querySelector('a[href*="/status/"]')?.href;
    if (tweetUrl && pathname.includes('/status/') && tweetUrl.includes(pathname.split('/status/')[1].split('/')[0])) {
        return true;
    }
    return false;
}

function closeDialog() {
    const closeBtn = document.querySelector('div[role="dialog"] button[aria-label="Close"]');
    if(closeBtn) closeBtn.click();
}

async function simulateReactInput(element, text) {
  element.focus();
  await randomDelay(100);
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, text);
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function clickSendButton() {
    let attempts = 0;
    while (attempts < 5) { 
        if (!isRunning) return false;
        const sendButton = document.querySelector('div[role="dialog"] button[data-testid="tweetButton"]');
        if (sendButton && !sendButton.disabled && sendButton.getAttribute('aria-disabled') !== 'true') {
            sendButton.click();
            return true;
        }
        await randomDelay(500);
        attempts++;
    }
    return false;
}

function waitForElement(selector, timeout) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) return resolve(document.querySelector(selector));
        const observer = new MutationObserver(() => {
            if (document.querySelector(selector)) {
                observer.disconnect();
                resolve(document.querySelector(selector));
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
    });
}

function updateCount(add = 0) {
    chrome.storage.local.get(['totalReplies'], (data) => {
        const newCount = (data.totalReplies || 0) + add;
        if(add > 0) chrome.storage.local.set({ totalReplies: newCount });
        chrome.runtime.sendMessage({ type: "UPDATE_COUNT", payload: { count: newCount } }).catch(()=>{});
    });
}

function randomDelay(min, max) {
    if (!max) max = min;
    return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

// --- 手动按钮注入 (可选，保持不变) ---
const manualObserver = new MutationObserver((mutations) => {
  if (!isRunning) { 
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) injectButtons();
      }
  }
});
manualObserver.observe(document.body, { childList: true, subtree: true });

function injectButtons() {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');
    tweets.forEach((tweet) => {
      if (tweet.querySelector(".ai-reply-btn")) return;
      const actionBar = tweet.querySelector('div[role="group"]');
      if (actionBar) {
        const btnContainer = document.createElement("div");
        btnContainer.className = "ai-reply-btn";
        btnContainer.style.cssText = "display: flex; align-items: center; margin-left: 12px; cursor: pointer; color: #1d9bf0;";
        btnContainer.innerHTML = AI_ICON;
        btnContainer.title = "AI 生成"; 
        btnContainer.onclick = async (e) => {
            e.preventDefault(); e.stopPropagation();
            const text = tweet.querySelector('div[data-testid="tweetText"]')?.innerText || "";
            try {
                const reply = await generateReplyFromAI(text);
                alert("AI 回复已复制:\n" + reply);
                navigator.clipboard.writeText(reply);
            } catch(err) { alert(err.message); }
        };
        actionBar.appendChild(btnContainer);
      }
    });
}