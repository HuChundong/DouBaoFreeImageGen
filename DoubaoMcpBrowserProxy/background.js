// Function to clear all cookies
async function clearAllCookies() {
  // 检查设置
  const result = await chrome.storage.sync.get(['clearCookies']);
  if (result.clearCookies === false) {
    console.log("Cookie clearing is disabled in settings");
    return;
  }

  console.log("Clearing all cookies");
  try {
    const allCookies = await chrome.cookies.getAll({});
    for (const cookie of allCookies) {
      const protocol = cookie.secure ? "https:" : "http:";
      const cookieUrl = `${protocol}//${cookie.domain.replace(/^\./, "")}${
        cookie.path
      }`;
      await chrome.cookies.remove({
        url: cookieUrl,
        name: cookie.name,
        storeId: cookie.storeId,
      });
    }
    console.log("All cookies cleared successfully");
  } catch (error) {
    console.error("Error clearing cookies:", error);
  }
}

// 监听页面导航事件
chrome.webNavigation.onCommitted.addListener(
  async (details) => {
    if (details.frameId === 0) {
      // 只处理主框架
      await clearAllCookies();
    }
  },
  { url: [{ schemes: ["http", "https"] }] }
);

// 安装或更新时清除cookie
chrome.runtime.onInstalled.addListener(clearAllCookies);
streamRequestIds = new Set();
// 添加调试器监听器来拦截 EventStream 请求
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (method === "Network.responseReceived") {
    const requestId = params.requestId; // 获取 requestId
    const response = params.response;

    // 检查 Content-Type 是否为 text/event-stream
    const contentType =
      response.headers["content-type"] || response.headers["Content-Type"]; // Header names can be case-insensitive
    if (contentType && contentType.includes("text/event-stream")) {
      console.log("EventStream Response Headers Received:", response);
      console.log("Request ID for EventStream:", requestId);
      streamRequestIds.add(requestId);
    }
  }
  // 如果你想捕获 EventSource 发送的单个消息（SSE 事件）
  // 你也可以监听 'Network.eventSourceMessageReceived'
  else if (method === "Network.loadingFinished") {
    const { requestId } = params;
    // 判断请求的id是否被记录，是stream类型
    if (streamRequestIds.has(requestId)) {
      try {
        // 使用 Network.getResponseBody 获取响应体
        // source 是 debuggee target，可以直接传递
        const responseBodyData = await chrome.debugger.sendCommand(
          source,
          "Network.getResponseBody",
          { requestId: requestId }
        );

        // responseBodyData 包含 { body: string, base64Encoded: boolean }
        let responseBody = responseBodyData.body;
        if (responseBodyData.base64Encoded) {
          // 如果是 base64 编码的，需要解码
          // 对于 text/event-stream，通常不会是 base64 编码的，但以防万一
          try {
            responseBody = atob(responseBody);
          } catch (e) {
            console.error("Failed to decode base64 body for event stream:", e);
            // Fallback to using the raw base64 string if decoding fails
          }
        }

        console.log("EventStream Response Body:", responseBody);

        // 解析EventStream响应
        const lines = responseBody.split('\n');
        const imageUrls = []; // 存储所有图片URL

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6); // 移除 'data: ' 前缀
              const data = JSON.parse(jsonStr);
              
              // 检查是否包含图片数据
              if (data.event_data) {
                const eventData = JSON.parse(data.event_data);
                if (eventData.message && eventData.message.content) {
                  const content = JSON.parse(eventData.message.content);
                  if (content.creations && Array.isArray(content.creations)) {
                    // 处理每个图片创建结果（旧结构）
                    content.creations.forEach(creation => {
                      if (creation.type === 1 && creation.image && creation.image.image_raw) {
                        const imageUrl = creation.image.image_raw.url;
                        if (imageUrl) {
                          imageUrls.push(imageUrl);
                          console.log('Found image URL:', imageUrl);
                        }
                      }
                    });
                  } else if (content.data && Array.isArray(content.data)) {
                    // 兼容新结构，遍历 data 数组
                    content.data.forEach(item => {
                      if (item.image_raw && item.image_raw.url) {
                        imageUrls.push(item.image_raw.url);
                        console.log('Found image URL (data):', item.image_raw.url);
                      }
                      // 如需其它格式可在此补充
                    });
                  }
                }
              }
            } catch (error) {
              console.error('Error parsing EventStream data:', error);
            }
          }
        }

        // 输出找到的所有图片URL
        if (imageUrls.length > 0) {
          console.log('Total images found:', imageUrls.length);
          console.log('All image URLs:', imageUrls);
          
          // 向content.js发送消息
          chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs[0]) {
              console.log('发送图片清单')
              chrome.tabs.sendMessage(tabs[0].id, {
                type: 'IMAGE_URLS',
                urls: imageUrls
              });
            }
          });
        }

        // 注意：对于 text/event-stream，Network.getResponseBody 可能只返回已接收到的部分
        // 或者在流结束时返回全部。如果你需要实时处理每个事件，
        // 你可能需要监听 'Network.eventSourceMessageReceived' 事件。
        // 但 'Network.getResponseBody' 会尝试获取当前可用的完整或部分主体。
      } catch (error) {
        console.error(
          `Error getting response body for requestId ${requestId}:`,
          error
        );
        // 常见错误：
        // - "No resource with given identifier found": 请求可能已完成或被取消，或者 requestId 无效。
        // - "Can only get response body on main resource": 不太可能用于 event-stream。
        // - If the stream is still actively pushing data and not yet "finished" in some sense,
        //   getResponseBody might give you what's buffered so far.
      }
      streamRequestIds.delete(requestId);
    }
  }
});

// --- WebSocket Logic ---
const DEFAULT_WEBSOCKET_URL = 'ws://localhost:8080';
const RECONNECT_DELAY_MS = 5000;
let ws = null;
let reconnectTimeout = null;

// 多tab管理
let doubaoTabs = new Map(); // tabId -> { id, url, status: 'idle' | 'busy', lastUsed: timestamp }
let taskQueue = []; // 任务队列
let currentTabIndex = 0; // 轮询索引

// tab状态管理
function addDoubaoTab(tabId, url) {
  doubaoTabs.set(tabId, {
    id: tabId,
    url: url,
    status: 'idle',
    lastUsed: Date.now()
  });
  console.log(`[TabManager] Added tab ${tabId}, total tabs: ${doubaoTabs.size}`);
}

function removeDoubaoTab(tabId) {
  if (doubaoTabs.has(tabId)) {
    doubaoTabs.delete(tabId);
    console.log(`[TabManager] Removed tab ${tabId}, remaining tabs: ${doubaoTabs.size}`);
  }
}

function setTabStatus(tabId, status) {
  if (doubaoTabs.has(tabId)) {
    doubaoTabs.get(tabId).status = status;
    if (status === 'idle') {
      doubaoTabs.get(tabId).lastUsed = Date.now();
    }
    console.log(`[TabManager] Tab ${tabId} status changed to ${status}`);
  }
}

function getIdleTab() {
  // 轮询策略：找到空闲的tab
  const idleTabs = Array.from(doubaoTabs.values()).filter(tab => tab.status === 'idle');
  
  if (idleTabs.length === 0) {
    return null;
  }
  
  // 使用轮询策略选择tab
  const selectedTab = idleTabs[currentTabIndex % idleTabs.length];
  currentTabIndex = (currentTabIndex + 1) % idleTabs.length;
  
  return selectedTab;
}

function getAllDoubaoTabs() {
  return Array.from(doubaoTabs.values());
}

// 任务分发
function dispatchTask(task) {
  const idleTab = getIdleTab();
  
  if (idleTab) {
    // 有空闲tab，直接分发
    setTabStatus(idleTab.id, 'busy');
    sendTaskToTab(idleTab.id, task);
    return true;
  } else {
    // 没有空闲tab，加入队列
    taskQueue.push(task);
    console.log(`[TaskManager] Task queued. Queue length: ${taskQueue.length}`);
    return false;
  }
}

function sendTaskToTab(tabId, task) {
  chrome.tabs.sendMessage(tabId, {
    type: 'COMMAND_FROM_SERVER',
    data: task
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error(`[TaskManager] Failed to send task to tab ${tabId}:`, chrome.runtime.lastError);
      // 如果发送失败，将tab标记为空闲并重新分发任务
      setTabStatus(tabId, 'idle');
      processTaskQueue();
    }
  });
}

function processTaskQueue() {
  while (taskQueue.length > 0) {
    const task = taskQueue.shift();
    if (!dispatchTask(task)) {
      // 如果无法分发，重新加入队列头部
      taskQueue.unshift(task);
      break;
    }
  }
}

// 任务完成回调
function onTaskCompleted(tabId) {
  setTabStatus(tabId, 'idle');
  processTaskQueue(); // 处理队列中的任务
}

function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        console.log("[WebSocket] Connection already connecting or open.");
        return;
    }

    chrome.storage.sync.get(['wsUrl'], (result) => {
        const websocketUrl = result.wsUrl || DEFAULT_WEBSOCKET_URL;
        console.log(`[WebSocket] Attempting to connect to ${websocketUrl}`);

        try {
            ws = new WebSocket(websocketUrl);

            ws.onopen = () => {
                console.log("[WebSocket] Connected successfully.");
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
                
                // 通知所有tab连接已建立
                const allTabs = getAllDoubaoTabs();
                allTabs.forEach(tab => {
                    chrome.tabs.get(tab.id, (tabInfo) => {
                        if (tabInfo) {
                            sendWebSocketMessage({ type: 'scriptReady', url: tabInfo.url, tabId: tab.id });
                        }
                    });
                });
            };

            ws.onmessage = (event) => {
                console.log("[WebSocket] Message from server:", event.data);
                
                try {
                    const message = JSON.parse(event.data);
                    
                    // 如果消息指定了特定的tabId
                    if (message.targetTabId && doubaoTabs.has(message.targetTabId)) {
                        sendTaskToTab(message.targetTabId, event.data);
                    } else {
                        // 使用轮询策略分发任务
                        dispatchTask(event.data);
                    }
                } catch (e) {
                    // 如果不是JSON格式，直接分发
                    dispatchTask(event.data);
                }
            };

            ws.onerror = (error) => {
                console.warn("[WebSocket] Error:", error);
                ws.close();
            };

            ws.onclose = (event) => {
                console.log(`[WebSocket] Disconnected (code: ${event.code}, reason: ${event.reason}).`);
                ws = null;
                if (!event.wasClean) {
                    scheduleReconnect();
                }
            };

        } catch (e) {
            console.error("[WebSocket] Failed to create WebSocket instance:", e);
            scheduleReconnect();
        }
    });
}

function scheduleReconnect() {
    if (reconnectTimeout === null) {
        console.log(`[WebSocket] Scheduling reconnect in ${RECONNECT_DELAY_MS}ms...`);
        reconnectTimeout = setTimeout(() => {
            reconnectTimeout = null;
            connectWebSocket();
        }, RECONNECT_DELAY_MS);
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'COLLECTED_IMAGE_URLS') {
        console.log('[Background] Received collected image URLs from content script:', message.urls);
        sendWebSocketMessage({ 
            type: 'collectedImageUrls', 
            urls: message.urls,
            tabId: sender.tab.id
        });
    } else if (message.type === 'TASK_COMPLETED') {
        // content script通知任务完成
        console.log(`[Background] Task completed on tab ${sender.tab.id}`);
        onTaskCompleted(sender.tab.id);
        sendResponse({ success: true });
    } else if (message.type === 'TAB_STATUS_UPDATE') {
        // content script更新tab状态
        if (message.status) {
            setTabStatus(sender.tab.id, message.status);
        }
        sendResponse({ success: true });
    } else if (message.type === 'GET_TAB_STATUS') {
        // 获取所有tab状态
        const tabStatus = getAllDoubaoTabs().map(tab => ({
            id: tab.id,
            status: tab.status,
            lastUsed: tab.lastUsed,
            url: tab.url
        }));
        sendResponse({ 
            tabs: tabStatus, 
            queueLength: taskQueue.length,
            wsConnected: ws && ws.readyState === WebSocket.OPEN
        });
        return true;
    } else if (message.type === 'FORCE_TASK_DISPATCH') {
        // 强制分发指定任务到指定tab
        if (message.tabId && message.task && doubaoTabs.has(message.tabId)) {
            sendTaskToTab(message.tabId, message.task);
            sendResponse({ success: true });
        } else {
            sendResponse({ success: false, error: 'Invalid tab or task' });
        }
        return true;
    }
});

// 为所有标签页附加调试器
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url?.startsWith("https://www.doubao.com")
  ) {
    // 添加到tab管理器
    addDoubaoTab(tabId, tab.url);
    
    // 如果这是第一个tab，建立WebSocket连接
    if (doubaoTabs.size === 1) {
      connectWebSocket();
    }
    
    try {
      chrome.debugger.attach({ tabId }, "1.0", () => {
        if (chrome.runtime.lastError) {
          console.error("Debugger attach error:", chrome.runtime.lastError);
          return;
        }
        chrome.debugger.sendCommand({ tabId }, "Network.enable", {}, () => {
          if (chrome.runtime.lastError) {
            console.error("Network enable error:", chrome.runtime.lastError);
          }
        });
      });
    } catch (error) {
      console.error("Debugger error:", error);
    }
  }
});

// 在标签页关闭时分离调试器
chrome.tabs.onRemoved.addListener((tabId) => {
  if (doubaoTabs.has(tabId)) {
    removeDoubaoTab(tabId);
    
    // 如果没有剩余的豆包tab，关闭WebSocket
    if (doubaoTabs.size === 0) {
      if (ws) {
        ws.close();
      }
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
      taskQueue = []; // 清空任务队列
      currentTabIndex = 0; // 重置轮询索引
    }
  }
  
  try {
    chrome.debugger.detach({ tabId });
  } catch (error) {
    console.error("Debugger detach error:", error);
  }
});


