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

// 为所有标签页附加调试器
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url?.startsWith("https://www.doubao.com")
  ) {
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
  try {
    chrome.debugger.detach({ tabId });
  } catch (error) {
    console.error("Debugger detach error:", error);
  }
});
