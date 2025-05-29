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
let imageCollectionTimer = null;

// --- WebSocket Logic ---
function connectWebSocket() {
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

        console.log("[Cleanup] Reloading page...");
        setTimeout(() => {
            window.location.href = 'https://www.doubao.com/chat/';
        }, 500);
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

// --- Image Finding Logic ---
const requiredDomainPrefix = 'ocean-cloud-tos/image_skill';
const originalPatternSuffix = '-image-dark-watermark.png';

function processImageElement(imgElement) {
    const imageUrl = imgElement.src;

    if (!imageUrl) {
        return;
    }

    if (processedUrls.has(imageUrl)) {
        return;
    }

    try {
        const url = new URL(imageUrl);
        const pathname = url.pathname;

        if (imageUrl.includes(requiredDomainPrefix) && pathname.endsWith(originalPatternSuffix)) {
            console.log('[Image Finder] Found matching image URL:', imageUrl);
            processedUrls.add(imageUrl);
            foundImageUrls.push(imageUrl);
            console.log(`[Image Finder] Added URL to collection. Total collected: ${foundImageUrls.length}`);

            console.log(`[Image Finder] Scheduling send/cleanup in ${IMAGE_COLLECTION_SETTLE_DELAY_MS}ms (timer reset).`);
            clearTimeout(imageCollectionTimer);
            imageCollectionTimer = setTimeout(performSendAndCleanup, IMAGE_COLLECTION_SETTLE_DELAY_MS);
        }
    } catch (e) {
        console.error('[Image Finder] URL parsing error for src:', imgElement.src, e);
    }
}

// --- DOM Scanning & Observation ---
function scanForImagesInContainer(containerElement) {
    if (!containerElement || typeof containerElement.querySelectorAll !== 'function') {
        console.warn("[Image Finder] Cannot scan container, element is invalid.");
        return;
    }
    console.log("[Image Finder] Performing initial scan for images in container...");
    const images = containerElement.querySelectorAll('img');
    images.forEach(processImageElement);
    console.log(`[Image Finder] Initial scan completed. ${images.length} images found. Debounce timer potentially started.`);
}

const observerCallback = (mutationList, observer) => {
    let imagesFoundInMutation = 0;
    for (const mutation of mutationList) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            for (const addedNode of mutation.addedNodes) {
                if (addedNode.nodeType === Node.ELEMENT_NODE) {
                    if (addedNode.tagName === 'IMG') {
                        processImageElement(addedNode);
                        imagesFoundInMutation++;
                    }
                    const newImagesInSubtree = addedNode.querySelectorAll('img');
                    if (newImagesInSubtree.length > 0) {
                        newImagesInSubtree.forEach(processImageElement);
                        imagesFoundInMutation += newImagesInSubtree.length;
                    }
                }
            }
        }
    }
};

const observer = new MutationObserver(observerCallback);
const observerConfig = { childList: true, subtree: true };

// --- Initialization ---
window.addEventListener('load', () => {
    console.log("[Script] Window 'load' event triggered. Starting initial scan and observer.");

    connectWebSocket();

    setTimeout(() => {
        scanForImagesInContainer(document.body || document.documentElement);
        console.log("[Script] Initial DOM scan and image collection phase 1 completed.");
    }, 1000);

    setTimeout(() => {
        try {
            const targetNode = document.body || document.documentElement;
            if (targetNode) {
                observer.observe(targetNode, observerConfig);
                console.log("[Script] MutationObserver started observing:", targetNode.tagName || 'Document');
                console.log("[Script] Dynamic image collection enabled.");
            } else {
                console.warn("[Script] Could not find a suitable node (body or documentElement) to observe.");
            }
        } catch (e) {
            console.error("[Script] Failed to start MutationObserver:", e);
        }
    }, 500);
});

// --- Cleanup ---
window.addEventListener('beforeunload', () => {
    console.log("[Script] Page is unloading. Cleaning up resources.");
    if (observer) {
        observer.disconnect();
        console.log("[Script] MutationObserver disconnected.");
    }
    clearTimeout(imageCollectionTimer);
    console.log("[Script] Image collection debounce timer cleared.");

    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close(1000, "Page unloading");
        console.log("[Script] WebSocket connection closed.");
    }
    clearTimeout(reconnectTimeout);
}); 