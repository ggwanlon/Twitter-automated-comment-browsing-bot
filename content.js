// content.js

// --- 全局状态 ---
let isRunning = false;
let processedTweetIds = new Set(); // 评论去重
let processedLikeIds = new Set();  // 点赞去重
let isProcessingReply = false;     // 互斥锁

const AI_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/><path d="M12 6a1 1 0 0 0-1 1v2H9a1 1 0 0 0 0 2h2v2a1 1 0 0 0 2 0v-2h2a1 1 0 0 0 0-2h-2V7a1 1 0 0 0-1-1z"/></svg>`;

// --- 初始化 ---
chrome.runtime.sendMessage({ type: "CONTENT_READY" });

chrome.storage.local.get(['isRunning'], (data) => {
  if (data.isRunning) setTimeout(startAutomation, 3000);
});

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.type === "STATE_CHANGE") {
    if (req.payload.isRunning) startAutomation();
    else stopAutomation();
  }
  return true;
});

// --- 自动化主流程 ---

async function startAutomation() {
  if (isRunning) return;
  isRunning = true;
  console.log("AI 助手：开始运行 (评论 + 点赞)...");
  
  automationLoop(); // 评论线程
  autoLikeLoop();   // 点赞线程
}

function stopAutomation() {
  isRunning = false;
  console.log("AI 助手：停止运行");
}

// === 循环 A: 自动评论 ===
async function automationLoop() {
  while (isRunning) {
    const candidate = findBestCandidate();

    if (candidate) {
      await triggerAutoReply(candidate);
    } else {
      // 如果没有候选且没有在写评论，小幅度滚动
      if (!isProcessingReply) {
        console.log("评论循环：搜寻中...");
        window.scrollBy({ top: 300, behavior: 'smooth' });
      }
      await randomDelay(2000, 3000); 
    }
  }
}

// === 循环 B: 自动点赞 ===
async function autoLikeLoop() {
    console.log("点赞循环：已启动");
    while (isRunning) {
        try {
            // 互斥检查
            if (isProcessingReply) {
                await randomDelay(2000, 4000);
                continue;
            }

            const likeCandidate = findBestLikeCandidate();

            if (likeCandidate) {
                const btn = likeCandidate.button;
                const tweetId = likeCandidate.id;
                
                console.log(`❤️ 点赞推文: ${tweetId}`);
                
                btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await randomDelay(1000, 2000);

                if (!isRunning) break;
                if (isProcessingReply) continue; 

                btn.click();
                processedLikeIds.add(tweetId);
                
                // [新增] 更新点赞计数
                updateLikeCount(1);

                console.log("❤️ 点赞完成，下滑并等待...");
                await randomDelay(1000, 2000);
                window.scrollBy({ top: 400, behavior: 'smooth' });

                // 20 - 40 秒等待
                await randomDelay(20 * 1000, 40 * 1000);

            } else {
                await randomDelay(2000, 5000);
            }

        } catch (e) {
            console.error("点赞循环出错:", e);
            await randomDelay(5000);
        }
    }
}

// --- 查找逻辑 ---

function findBestCandidate() {
  const allTweets = document.querySelectorAll('article[data-testid="tweet"]');
  for (let tweet of allTweets) {
    if (!isInViewport(tweet)) continue; 
    const id = getTweetId(tweet);
    if (!id || processedTweetIds.has(id)) continue;
    const text = tweet.innerText;
    if (text.includes("Ad") || text.includes("Promoted") || text.includes("广告")) continue;
    if (isMainTweet(tweet)) { processedTweetIds.add(id); continue; }
    return tweet;
  }
  return null;
}

function findBestLikeCandidate() {
    const allTweets = document.querySelectorAll('article[data-testid="tweet"]');
    for (let tweet of allTweets) {
        if (!isInViewport(tweet)) continue;
        const id = getTweetId(tweet);
        if (!id || processedLikeIds.has(id)) continue;

        const likeBtn = tweet.querySelector('button[data-testid="like"]');
        const unlikeBtn = tweet.querySelector('button[data-testid="unlike"]');

        if (unlikeBtn) {
            processedLikeIds.add(id);
            continue;
        }
        if (likeBtn) {
            const text = tweet.innerText;
            if (text.includes("Ad") || text.includes("Promoted") || text.includes("广告")) continue;
            return { button: likeBtn, id: id };
        }
    }
    return null;
}

function isInViewport(el) {
    const rect = el.getBoundingClientRect();
    return (
        rect.top >= -200 && 
        rect.top <= (window.innerHeight || document.documentElement.clientHeight)
    );
}

// --- 评论执行逻辑 ---

async function triggerAutoReply(tweetElement) {
  if (!isRunning) return;
  isProcessingReply = true; // 上锁

  const tweetId = getTweetId(tweetElement);
  processedTweetIds.add(tweetId); 

  try {
    tweetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await randomDelay(1500, 2500);
    if (!isRunning) return;

    const textNode = tweetElement.querySelector('div[data-testid="tweetText"]');
    const tweetText = textNode ? textNode.innerText : "";
    if (!tweetText) return;

    console.log(`💬 生成回复中...`);

    const replyText = await generateReplyFromAI(tweetText);
    if (!isRunning) return;
    
    const replyButton = tweetElement.querySelector('button[data-testid="reply"]');
    if (!replyButton) throw new Error("无回复按钮");
    replyButton.click();

    const inputBox = await waitForElement('div[role="dialog"] div[role="textbox"]', 5000);
    if (!inputBox) throw new Error("输入框未出现");
    if (!isRunning) { closeDialog(); return; }

    await simulateReactInput(inputBox, replyText);
    await randomDelay(1000, 2000);
    if (!isRunning) { closeDialog(); return; }

    const sent = await clickSendButton();

    if (sent) {
        updateCount(1); // 更新评论计数
        console.log("✅ 评论发送成功");
        isProcessingReply = false; // 立即解锁

        await randomDelay(3000, 5000);
        window.scrollBy({ top: 1200, behavior: 'smooth' });

        console.log("⏳ 评论冷却 (2-3min)...");
        await randomDelay(30 * 1000, 180 * 1000);
        
        if (isRunning) window.scrollBy({ top: 600, behavior: 'smooth' });
    } else {
        closeDialog();
    }

  } catch (e) {
    console.error("评论失败:", e.message);
    closeDialog();
    window.scrollBy({ top: 100, behavior: 'smooth' });
  } finally {
    isProcessingReply = false; // 确保解锁
  }
}

// --- AI 请求 ---
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
            model: config.modelName, // 这里会自动读取下拉菜单或自定义输入框保存的值
            messages: messages
        }
    });

    if (!response || !response.success) {
        throw new Error(response?.error || "AI Error");
    }
    return response.reply;
}

// --- 工具函数 & 计数更新 ---

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
    if (tweetUrl && pathname.includes('/status/') && tweetUrl.includes(pathname.split('/status/')[1].split('/')[0])) return true;
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

// 更新评论数
function updateCount(add = 0) {
    chrome.storage.local.get(['totalReplies'], (data) => {
        const newCount = (data.totalReplies || 0) + add;
        if(add > 0) chrome.storage.local.set({ totalReplies: newCount });
        chrome.runtime.sendMessage({ type: "UPDATE_COUNT", payload: { count: newCount } }).catch(()=>{});
    });
}

// [新增] 更新点赞数
function updateLikeCount(add = 0) {
    chrome.storage.local.get(['totalLikes'], (data) => {
        const newCount = (data.totalLikes || 0) + add;
        if(add > 0) chrome.storage.local.set({ totalLikes: newCount });
        // 发送特定消息给 Popup 更新 UI
        chrome.runtime.sendMessage({ type: "UPDATE_LIKES", payload: { count: newCount } }).catch(()=>{});
    });
}

function randomDelay(min, max) {
    if (!max) max = min;
    return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

// --- 手动按钮注入 (不变) ---
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