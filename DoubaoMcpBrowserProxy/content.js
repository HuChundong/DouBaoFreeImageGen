// 监听 history API
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

history.pushState = function() {
  originalPushState.apply(this, arguments);
  chrome.runtime.sendMessage({ type: 'NAVIGATION' });
};

history.replaceState = function() {
  originalReplaceState.apply(this, arguments);
  chrome.runtime.sendMessage({ type: 'NAVIGATION' });
};

// 监听 location.href 修改
let lastHref = location.href;
new MutationObserver(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    chrome.runtime.sendMessage({ type: 'NAVIGATION' });
  }
}).observe(document, { subtree: true, childList: true });

// 监听 hashchange 事件
window.addEventListener('hashchange', () => {
  chrome.runtime.sendMessage({ type: 'NAVIGATION' });
});

// --- Configuration ---
const WEBSOCKET_URL = 'ws://localhost:8080';
const CHAT_INPUT_SELECTOR = '[data-testid="chat_input_input"]';
const RECONNECT_DELAY_MS = 5000;
const INPUT_SEND_DELAY_MS = 200;
const TEST_COMMAND_DELAY_MS = 3000;
const IMAGE_COLLECTION_SETTLE_DELAY_MS = 1500;

// --- Global State ---
let ws = null;
let reconnectTimeout = null;
const processedUrls = new Set();
const foundImageUrls = [];
const downloadImageUrls = []; // 用于下载的独立图片列表
let imageCollectionTimer = null;
let shouldAutoReload = true; // 默认开启自动刷新
let shouldClearCookies = true; // 默认清除cookie
let downloadButton = null; // 下载按钮引用

// 监听来自background.js的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'IMAGE_URLS') {
        console.log('[Message Handler] Received image URLs from background:', message.urls);
        
        // 将新的URL添加到foundImageUrls中
        message.urls.forEach(url => {
            if (!processedUrls.has(url)) {
                processedUrls.add(url);
                foundImageUrls.push(url);
                downloadImageUrls.push(url); // 同时添加到下载列表
                console.log(`[Message Handler] Added URL to collection. Total collected: ${foundImageUrls.length}`);
            }
        });

        // 更新下载按钮状态
        updateDownloadButton();

        // 直接发送并清理
        performSendAndCleanup();
    }
});

// 从 Chrome 存储中读取设置
chrome.storage.sync.get(['autoReload', 'clearCookies'], function(result) {
    if (result.autoReload !== undefined) {
        shouldAutoReload = result.autoReload;
        console.log(`[Settings] Auto reload is ${shouldAutoReload ? 'enabled' : 'disabled'}`);
    }
    if (result.clearCookies !== undefined) {
        shouldClearCookies = result.clearCookies;
        console.log(`[Settings] Clear cookies is ${shouldClearCookies ? 'enabled' : 'disabled'}`);
    }
});

// 监听设置变化
chrome.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'sync') {
        if (changes.autoReload) {
            shouldAutoReload = changes.autoReload.newValue;
            console.log(`[Settings] Auto reload setting changed to ${shouldAutoReload}`);
        }
        if (changes.clearCookies) {
            shouldClearCookies = changes.clearCookies.newValue;
            console.log(`[Settings] Clear cookies setting changed to ${shouldClearCookies}`);
        }
    }
});

// --- WebSocket Logic ---
function connectWebSocket() {
    // 确保下载按钮已创建
    createDownloadButton();
    
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        console.log("[WebSocket] Connection already connecting or open.");
        return;
    }

    console.log(`[WebSocket] Attempting to connect to ${WEBSOCKET_URL}`);

    try {
        ws = new WebSocket(WEBSOCKET_URL);

        ws.onopen = () => {
            console.log("[WebSocket] Connected successfully.");
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
            sendWebSocketMessage({ type: 'scriptReady', url: window.location.href });
        };

        ws.onmessage = (event) => {
            console.log("[WebSocket] Message from server:", event.data);
            let handled = false;

            try {
                const message = JSON.parse(event.data);
                if (message && typeof message === 'object') {
                    if (message.type === 'command' && typeof message.text === 'string') {
                        console.log("[WebSocket] Received structured command message.");
                        handleReceivedCommand(message.text);
                        handled = true;
                    }
                }
            } catch (e) {
                // JSON parsing failed, handle as plain string
            }

            if (!handled && typeof event.data === 'string') {
                console.log("[WebSocket] Handling message as a plain string command (fallback).");
                handleReceivedCommand(event.data);
                handled = true;
            }

            if (!handled) {
                console.warn("[WebSocket] Received unhandled message type or format:", event.data);
            }
        };

        ws.onerror = (error) => {
            console.error("[WebSocket] Error:", error);
            if (ws && ws.readyState !== WebSocket.CLOSED) {
                console.log("[WebSocket] Closing socket due to error to trigger reconnect logic.");
                ws.close();
            } else {
                scheduleReconnect();
            }
        };

        ws.onclose = (event) => {
            console.log(`[WebSocket] Disconnected (code: ${event.code}, reason: ${event.reason}).`);
            ws = null;
            if (!event.wasClean) {
                console.warn("[WebSocket] Connection closed abnormally. Attempting reconnect.");
                scheduleReconnect();
            } else {
                console.log("[WebSocket] Connection closed cleanly.");
            }
        };

    } catch (e) {
        console.error("[WebSocket] Failed to create WebSocket instance:", e);
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    if (reconnectTimeout === null) {
        console.log(`[WebSocket] Scheduling reconnect in ${RECONNECT_DELAY_MS}ms...`);
        reconnectTimeout = setTimeout(() => {
            reconnectTimeout = null;
            connectWebSocket();
        }, RECONNECT_DELAY_MS);
    } else {
        console.log("[WebSocket] Reconnect already scheduled.");
    }
}

function sendWebSocketMessage(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            const message = typeof data === 'object' ? JSON.stringify(data) : String(data);
            ws.send(message);
        } catch (e) {
            console.error("[WebSocket] Failed to send message:", data, e);
        }
    } else {
        console.warn("[WebSocket] Cannot send message, WebSocket is not OPEN. Message:", data);
    }
}

// --- Image Collection & Cleanup ---
function performSendAndCleanup() {
    console.log("[Cleanup] Image discovery settled. Initiating send and cleanup...");
    imageCollectionTimer = null;

    if (foundImageUrls.length > 0) {
        console.log(`[Cleanup] Sending ${foundImageUrls.length} collected image URLs.`);
        sendWebSocketMessage({ type: 'collectedImageUrls', urls: foundImageUrls });
    } else {
        console.log("[Cleanup] No image URLs were collected during this session. Sending empty list.");
        sendWebSocketMessage({ type: 'collectedImageUrls', urls: [] });
    }

    setTimeout(() => {
        console.log("[Cleanup] Initiating storage cleanup after send delay...");

        try {
            localStorage.clear();
            console.log("[Cleanup] localStorage cleared.");
        } catch (e) {
            console.error("[Cleanup] Error clearing localStorage:", e);
        }

        try {
            sessionStorage.clear();
            console.log("[Cleanup] sessionStorage cleared.");
        } catch (e) {
            console.error("[Cleanup] Error clearing sessionStorage:", e);
        }

        foundImageUrls.length = 0;
        processedUrls.clear();
        console.log("[Cleanup] Internal image lists cleared.");

        if (shouldAutoReload) {
            console.log("[Cleanup] Auto reload is enabled. Reloading page...");
            setTimeout(() => {
                window.location.href = 'https://www.doubao.com/chat/';
            }, 500);
        } else {
            console.log("[Cleanup] Auto reload is disabled. Skipping page reload.");
        }
    }, 100);
}

// --- Input Handling ---
function findChatInput() {
    const element = document.querySelector(CHAT_INPUT_SELECTOR);
    if (element && element.tagName === 'TEXTAREA') {
        return element;
    }
    return null;
}

async function handleReceivedCommand(commandText) {
    const inputElement = findChatInput();

    if (!inputElement) {
        console.error("[Input] Chat input TEXTAREA element not found using selector:", CHAT_INPUT_SELECTOR);
        sendWebSocketMessage({ type: 'error', message: 'Chat input textarea element not found' });
        return;
    }

    console.log(`[Input] Received command: "${commandText}". Attempting to simulate typing and send.`);

    try {
        inputElement.focus();
        console.log("[Input] Focused the textarea element.");

        const newValue = commandText;

        try {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            if (nativeInputValueSetter) {
                nativeInputValueSetter.call(inputElement, newValue);
                console.log("Successfully set input value using native setter:", newValue);
            } else {
                inputElement.value = newValue;
                console.warn("Native value setter not available. Set input value using direct assignment as a fallback.");
            }
        } catch (e) {
            console.error("Error setting input value using native setter or direct assignment:", e);
            if (inputElement.value !== newValue) {
                inputElement.value = newValue;
                console.warn("Forced input value setting after error.");
            }
        }

        const inputEvent = new Event('input', {
            bubbles: true,
            cancelable: false,
        });

        inputElement.dispatchEvent(inputEvent);
        console.log("Simulated 'input' event dispatched.");

        setTimeout(() => {
            const enterEvent = new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
            });

            const dispatched = inputElement.dispatchEvent(enterEvent);
            console.log(`[Input] Dispatched 'keydown' (Enter) after delay. Event cancellation status: ${!dispatched}.`);
        }, INPUT_SEND_DELAY_MS);

    } catch (e) {
        console.error("[Input] Error during input simulation:", e);
        sendWebSocketMessage({ type: 'error', message: 'Input simulation failed', error: e.message });
    }
}

// --- Initialization ---

window.addEventListener('load', () => {
    console.log("[Script] Window 'load' event triggered. Starting WebSocket connection.");
    connectWebSocket();
});

// --- Cleanup ---
window.addEventListener('beforeunload', () => {
    console.log("[Script] Page is unloading. Cleaning up resources.");
    clearTimeout(imageCollectionTimer);
    console.log("[Script] Image collection debounce timer cleared.");

    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close(1000, "Page unloading");
        console.log("[Script] WebSocket connection closed.");
    }
    clearTimeout(reconnectTimeout);
});

// 创建下载按钮
function createDownloadButton() {
    if (downloadButton) {
        return;
    }

    // 创建按钮元素
    downloadButton = document.createElement('button');
    downloadButton.textContent = '无水印下载';
    downloadButton.style.cssText = `
        position: fixed;
        top: 10px;
        right: 150px;
        padding: 10px 20px;
        background-color: #4CAF50;
        color: white;
        border: none;
        border-radius: 12px;
        cursor: pointer;
        z-index: 9999;
        font-size: 12px;
    `;

    // 添加悬停效果
    downloadButton.addEventListener('mouseover', () => {
        downloadButton.style.backgroundColor = '#45a049';
    });
    downloadButton.addEventListener('mouseout', () => {
        downloadButton.style.backgroundColor = '#4CAF50';
    });

    // 添加点击事件
    downloadButton.addEventListener('click', async () => {
        if (downloadImageUrls.length === 0) {
            alert('没有可下载的图片');
            return;
        }

        // 创建下载链接并触发下载
        for (let i = 0; i < downloadImageUrls.length; i++) {
            const url = downloadImageUrls[i];
            try {
                // 获取图片数据
                const response = await fetch(url);
                const blob = await response.blob();
                
                // 创建下载链接
                const downloadUrl = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = `image_${i + 1}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                // 清理 URL 对象
                window.URL.revokeObjectURL(downloadUrl);
                
                // 添加延迟以避免浏览器阻止多个下载
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error(`下载图片失败: ${url}`, error);
            }
        }
    });

    document.body.appendChild(downloadButton);
}

// 更新下载按钮状态
function updateDownloadButton() {
    if (!downloadButton) {
        createDownloadButton();
    }
    
    if (downloadImageUrls.length > 0) {
        downloadButton.style.display = 'block';
        downloadButton.textContent = `下载图片 (${downloadImageUrls.length})`;
    } else {
        downloadButton.style.display = 'none';
    }
} 