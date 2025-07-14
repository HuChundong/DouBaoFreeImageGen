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
const CHAT_INPUT_SELECTOR = '[data-testid="chat_input_input"]';
const INPUT_SEND_DELAY_MS = 200;
const IMAGE_COLLECTION_SETTLE_DELAY_MS = 1500;

// --- Global State ---
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
    } else if (message.type === 'COMMAND_FROM_SERVER' && message.data) {
        console.log(`[Message Handler] Received command from background: "${message.data}"`);
        handleReceivedCommand(message.data);
    }
});

// 通知background script任务完成
function notifyTaskCompleted() {
    chrome.runtime.sendMessage({ type: 'TASK_COMPLETED' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('[TaskManager] Error notifying task completion:', chrome.runtime.lastError);
        } else {
            console.log('[TaskManager] Task completion notification sent successfully');
        }
    });
}

// 更新tab状态
function updateTabStatus(status) {
    chrome.runtime.sendMessage({ type: 'TAB_STATUS_UPDATE', status: status }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('[TaskManager] Error updating tab status:', chrome.runtime.lastError);
        } else {
            console.log(`[TaskManager] Tab status updated to ${status}`);
        }
    });
}

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

// --- Image Collection & Cleanup ---
function performSendAndCleanup() {
    console.log("[Cleanup] Image discovery settled. Initiating send and cleanup...");
    imageCollectionTimer = null;

    // WebSocket逻辑已移除，这里可以通过chrome.runtime.sendMessage或其他方式与background通信
    if (foundImageUrls.length > 0) {
        console.log(`[Cleanup] Sending ${foundImageUrls.length} collected image URLs.`);
        chrome.runtime.sendMessage({ type: 'COLLECTED_IMAGE_URLS', urls: foundImageUrls });
    } else {
        console.log("[Cleanup] No image URLs were collected during this session. Sending empty list.");
        chrome.runtime.sendMessage({ type: 'COLLECTED_IMAGE_URLS', urls: [] });
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
            }, 1500);
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
    // 开始处理任务，更新状态为忙碌
    updateTabStatus('busy');
    
    const inputElement = findChatInput();

    if (!inputElement) {
        console.error("[Input] Chat input TEXTAREA element not found using selector:", CHAT_INPUT_SELECTOR);
        // WebSocket逻辑已移除，这里可以通过chrome.runtime.sendMessage或其他方式与background通信
        chrome.runtime.sendMessage({ type: 'error', message: 'Chat input textarea element not found' });
        // 任务失败，恢复为空闲状态
        updateTabStatus('idle');
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
            
            // 任务完成通知
            setTimeout(() => {
                notifyTaskCompleted();
            }, 1000); // 给一些时间让输入完成
        }, INPUT_SEND_DELAY_MS);

    } catch (e) {
        console.error("[Input] Error during input simulation:", e);
        // WebSocket逻辑已移除，这里可以通过chrome.runtime.sendMessage或其他方式与background通信
        chrome.runtime.sendMessage({ type: 'error', message: 'Input simulation failed', error: e.message });
        // 任务失败，恢复为空闲状态
        updateTabStatus('idle');
    }
}

// --- Initialization ---

window.addEventListener('load', () => {
    console.log("[Script] Window 'load' event triggered.");
    // WebSocket连接逻辑已移除
    createDownloadButton();
    
    // 初始化tab状态为空闲
    updateTabStatus('idle');
});

// --- Cleanup ---
window.addEventListener('beforeunload', () => {
    console.log("[Script] Page is unloading. Cleaning up resources.");
    clearTimeout(imageCollectionTimer);
    console.log("[Script] Image collection debounce timer cleared.");
    // WebSocket关闭逻辑已移除
    
    // 清理tab状态
    updateTabStatus('idle');
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
        showImageDownloadModal();
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

// 添加弹窗相关函数
function showImageDownloadModal() {
    // 遮罩层和弹窗只创建一次
    let modalOverlay = document.getElementById('image-download-modal-overlay');
    let modal = document.getElementById('image-download-modal');

    if (!modalOverlay) {
        // 创建遮罩层
        modalOverlay = document.createElement('div');
        modalOverlay.id = 'image-download-modal-overlay';
        modalOverlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.4);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        document.body.appendChild(modalOverlay);
    }
    modalOverlay.style.display = 'flex';

    if (!modal) {
        // 创建弹窗主体
        modal = document.createElement('div');
        modal.id = 'image-download-modal';
        modal.style.cssText = `
            background: #fff;
            border-radius: 12px;
            padding: 24px 20px 16px 20px;
            max-width: 700px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 24px rgba(0,0,0,0.18);
            position: relative;
        `;
        modalOverlay.appendChild(modal);
    }
    modal.style.display = 'block';

    // 清空弹窗内容
    modal.innerHTML = '';

    // 关闭按钮
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `
        position: absolute;
        top: 10px;
        right: 18px;
        font-size: 24px;
        color: #888;
        cursor: pointer;
        font-weight: bold;
    `;
    closeBtn.onclick = hideImageDownloadModal;
    modal.appendChild(closeBtn);

    // 标题
    const title = document.createElement('div');
    title.textContent = '选择要下载的图片';
    title.style.cssText = 'font-size: 18px; font-weight: bold; margin-bottom: 18px;';
    modal.appendChild(title);

    // 图片列表
    const imgList = document.createElement('div');
    imgList.style.cssText = 'display: flex; flex-wrap: wrap; gap: 18px; justify-content: flex-start;';

    if (downloadImageUrls.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = '没有可下载的图片';
        imgList.appendChild(empty);
    } else {
        downloadImageUrls.forEach((url, idx) => {
            const imgBox = document.createElement('div');
            imgBox.style.cssText = 'display: flex; flex-direction: column; align-items: center; width: 120px;';

            const img = document.createElement('img');
            img.src = url;
            img.alt = `image_${idx+1}`;
            img.style.cssText = 'width: 100px; height: 100px; object-fit: contain; border: 1px solid #eee; border-radius: 8px; margin-bottom: 8px; background: #fafafa;';

            const btn = document.createElement('button');
            btn.textContent = '下载';
            btn.style.cssText = 'padding: 4px 12px; font-size: 13px; border-radius: 6px; border: none; background: #4CAF50; color: #fff; cursor: pointer;';
            btn.onclick = () => downloadSingleImage(url, idx);

            imgBox.appendChild(img);
            imgBox.appendChild(btn);
            imgList.appendChild(imgBox);
        });
    }
    modal.appendChild(imgList);

    // 全部下载按钮
    if (downloadImageUrls.length > 1) {
        const allBtn = document.createElement('button');
        allBtn.textContent = '全部下载';
        allBtn.style.cssText = 'margin-top: 18px; margin-right: 12px; padding: 8px 24px; font-size: 15px; border-radius: 8px; border: none; background: #2196F3; color: #fff; cursor: pointer;';
        allBtn.onclick = downloadAllImages;
        modal.appendChild(allBtn);
    }
    // 清空按钮
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清空';
    clearBtn.style.cssText = 'margin-top: 18px; padding: 8px 24px; font-size: 15px; border-radius: 8px; border: none; background: #f44336; color: #fff; cursor: pointer;';
    clearBtn.onclick = clearAllImages;
    modal.appendChild(clearBtn);
}

function hideImageDownloadModal() {
    const overlay = document.getElementById('image-download-modal-overlay');
    if (overlay) overlay.style.display = 'none';
}

async function downloadSingleImage(url, idx) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `image_${idx + 1}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
        alert('下载失败: ' + error);
    }
}

async function downloadAllImages() {
    for (let i = 0; i < downloadImageUrls.length; i++) {
        await downloadSingleImage(downloadImageUrls[i], i);
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}

// 添加清空函数
function clearAllImages() {
    downloadImageUrls.length = 0;
    foundImageUrls.length = 0;
    processedUrls.clear();
    updateDownloadButton();
    hideImageDownloadModal();
    // 重新弹出弹窗，显示空状态
    setTimeout(showImageDownloadModal, 100);
} 