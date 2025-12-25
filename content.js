// content.js

// --- 全局状态 ---
let isRunning = false;
let processedTweetIds = new Set();
// let scrollIntervalId = null; // [已移除] 不再需要自动滚动定时器
let scanObserver = null;
let replyQueue = [];
let isProcessingReply = false;

const AI_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/><path d="M12 6a1 1 0 0 0-1 1v2H9a1 1 0 0 0 0 2h2v2a1 1 0 0 0 2 0v-2h2a1 1 0 0 0 0-2h-2V7a1 1 0 0 0-1-1z"/></svg>`;

// --- 初始化与消息监听 ---

// 1. 发送握手信号
chrome.runtime.sendMessage({ type: "CONTENT_READY" });

// 2. 初始状态检查 (页面刷新后会执行这里)
chrome.storage.local.get(['isRunning'], (data) => {
  if (data.isRunning) {
    // 稍微延迟一下，确保页面 DOM 加载了一部分
    setTimeout(startAutomation, 1500);
  }
});

// 3. 监听来自 Background 的消息
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.type === "STATE_CHANGE") {
    const { isRunning: shouldRun } = req.payload;
    if (shouldRun) {
      startAutomation();
    } else {
      stopAutomation();
    }
  }
  return true;
});

// 手动按钮注入
const manualObserver = new MutationObserver((mutations) => {
  if (!isRunning) { // 只有在不运行时才积极注入手动按钮，节省性能
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          injectButtons();
        }
      }
  }
});
manualObserver.observe(document.body, { childList: true, subtree: true });


// --- 自动化核心逻辑 ---

async function startAutomation() {
  if (isRunning) return;
  isRunning = true;
  console.log("AI 助手：开始自动运行...");

  processedTweetIds.clear();

  // [修改] 移除了 scrollIntervalId 相关的 setInterval 代码
  // 不再自动滚动，依靠 scanObserver 捕捉当前屏，回复成功后才滚动

  // 1. 启动扫描
  scanObserver = new MutationObserver((mutations) => {
    if (!isRunning) return;
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          if (node.tagName === 'ARTICLE' && node.getAttribute('data-testid') === 'tweet') {
             enqueueTweet(node);
          }
          const tweets = node.querySelectorAll ? node.querySelectorAll('article[data-testid="tweet"]') : [];
          tweets.forEach(tweet => enqueueTweet(tweet));
        }
      });
    });
  });

  scanObserver.observe(document.body, { childList: true, subtree: true });

  // 2. 立即扫描一次当前页面
  const existingTweets = document.querySelectorAll('article[data-testid="tweet"]');
  existingTweets.forEach(t => enqueueTweet(t));

  // 3. 启动队列处理
  processReplyQueue();
}

function stopAutomation() {
  isRunning = false;
  console.log("AI 助手：停止运行");

  // 立即清空队列
  replyQueue = [];

  if (scanObserver) {
    scanObserver.disconnect();
    scanObserver = null;
  }
  // scrollIntervalId 已移除，无需清除
}

// --- 推文过滤与排队 ---

function enqueueTweet(tweetElement) {
  if (!isRunning) return;

  const tweetId = getTweetId(tweetElement);
  if (!tweetId || processedTweetIds.has(tweetId)) {
    return;
  }

  // 过滤广告
  if (tweetElement.innerText.includes("Ad") || tweetElement.innerText.includes("Promoted") || tweetElement.innerText.includes("广告")) {
      return;
  }

  // 过滤主贴
  if (isMainTweet(tweetElement)) {
    processedTweetIds.add(tweetId);
    return;
  }

  processedTweetIds.add(tweetId);
  replyQueue.push(tweetElement);
  updateCount();
}

function getTweetId(tweetElement) {
  const link = tweetElement.querySelector('a[href*="/status/"]');
  if (link) {
    const parts = link.href.split('/status/');
    if (parts.length > 1) {
      return parts[1].split('/')[0];
    }
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

// --- 队列处理 ---

async function processReplyQueue() {
  while (isRunning) { // 循环条件本身就是第一道防线
    if (replyQueue.length > 0 && !isProcessingReply) {
      const tweetElement = replyQueue.shift();
      // 再次检查元素是否还在文档中
      if (document.body.contains(tweetElement)) {
          await triggerAutoReply(tweetElement);
      }
    }
    // 稍微等待，避免死循环占用 CPU
    await randomDelay(1000, 2000);
  }
}

// --- AI 请求构建 ---

async function generateReplyFromAI(tweetText) {
    const config = await chrome.storage.local.get(['apiKey', 'apiUrl', 'modelName', 'systemPrompt']);
    if (!config.apiKey) throw new Error("请填写 API Key");

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
        throw new Error(response?.error || "Unknown AI Error");
    }

    return response.reply;
}

// --- 自动化操作核心 (加强停止检查) ---

async function triggerAutoReply(tweetElement) {
  if (!isRunning) return; // [Check 1]
  isProcessingReply = true;
  
  try {
    tweetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await randomDelay(3000); // 等待滚动结束

    if (!isRunning) return; // [Check 2]

    const textNode = tweetElement.querySelector('div[data-testid="tweetText"]');
    const tweetText = textNode ? textNode.innerText : "";
    if (!tweetText) return;

    console.log(`Processing: ${tweetText.slice(0, 20)}...`);

    // 1. 调用 AI
    const replyText = await generateReplyFromAI(tweetText);
    if (!isRunning) return; // [Check 3] AI 返回后立即检查
    console.log(`AI Reply: ${replyText}`);

    // 2. 点击回复按钮
    const replyButton = tweetElement.querySelector('button[data-testid="reply"]');
    if (!replyButton) throw new Error("Reply button not found");
    
    replyButton.click();
    
    // 3. 等待输入框
    const inputBox = await waitForElement('div[role="dialog"] div[role="textbox"]', 5000);
    if (!inputBox) throw new Error("Input box not open");

    if (!isRunning) { // [Check 4] 输入前检查，如果停止了，关闭弹窗并退出
        closeDialog(); 
        return; 
    }

    // 4. 模拟输入
    await simulateReactInput(inputBox, replyText);
    await randomDelay(500, 1000);

    if (!isRunning) { closeDialog(); return; } // [Check 5] 发送前最后检查

    // 5. 点击发送
    const sent = await clickSendButton();
    if (sent) {
        console.log("✅ Sent!");
        updateCount(1); 
        
        // [关键修改] 只有发送成功后，才进行滚动
        // 滚动距离设大一点(400-600)，确保翻过当前帖子，触发懒加载
        await randomDelay(2000, 3000); // 等待发送动画
        if (isRunning) {
            window.scrollBy({ top: 600, behavior: 'smooth' });
            await randomDelay(5000, 10000);
            window.scrollBy({ top: 600, behavior: 'smooth' });
            await randomDelay(120000, 150000);
        }
        
    } else {
        closeDialog();
    }

  } catch (err) {
    console.error("Skipped:", err.message);
    // 出错也尝试关闭弹窗，避免遮挡
    closeDialog();
  } finally {
    isProcessingReply = false;
  }
}

// 辅助：关闭弹窗
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
    while (attempts < 5) { // 减少尝试次数，加快响应
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

// 手动按钮注入逻辑 (保持不变)
function injectButtons() {
    // ... (保持原有的手动按钮逻辑，代码较长此处略去，无需修改) ...
    // 为了完整性，请确保保留原文件中的 createAIButton 和 injectButtons 函数
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');
    tweets.forEach((tweet) => {
      if (tweet.querySelector(".ai-reply-btn")) return;
      const actionBar = tweet.querySelector('div[role="group"]');
      if (actionBar) {
        const btnContainer = createAIButton(tweet);
        actionBar.appendChild(btnContainer);
      }
    });
}

function createAIButton(tweetElement) {
    const container = document.createElement("div");
    container.className = "ai-reply-btn";
    container.style.cssText = "display: flex; align-items: center; margin-left: 12px; cursor: pointer; color: #1d9bf0;";
    container.innerHTML = AI_ICON;
    container.title = "AI 生成"; // 仅生成不发送
  
    container.addEventListener("click", async (e) => {
      e.stopPropagation(); e.preventDefault();
      container.style.color = "orange";
      try {
          const textNode = tweetElement.querySelector('div[data-testid="tweetText"]');
          const text = textNode ? textNode.innerText : "";
          const reply = await generateReplyFromAI(text);
          // 手动模式流程...
          const replyButton = tweetElement.querySelector('button[data-testid="reply"]');
          replyButton.click();
          const inputBox = await waitForElement('div[role="dialog"] div[role="textbox"]', 3000);
          if (inputBox) await simulateReactInput(inputBox, reply);
          else { alert("已复制:\n" + reply); navigator.clipboard.writeText(reply); }
      } catch(err) { alert("错误: " + err.message); } 
      finally { container.style.color = "#1d9bf0"; }
    });
    return container;
}

function randomDelay(min, max) {
    if (!max) max = min;
    return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}