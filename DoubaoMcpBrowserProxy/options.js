// 保存设置到 Chrome 存储
function saveOptions() {
    const autoReload = document.getElementById('autoReload').checked;
    const clearCookies = document.getElementById('clearCookies').checked;
    const wsUrl = document.getElementById('wsUrl').value;

    chrome.storage.sync.set({ 
        autoReload,
        clearCookies,
        wsUrl
    }, () => {
        const status = document.getElementById('status');
        status.textContent = '设置已保存';
        status.className = 'status success';
        setTimeout(() => {
            status.className = 'status';
        }, 2000);
    });
}

// 从 Chrome 存储加载设置
function loadOptions() {
    chrome.storage.sync.get(['autoReload', 'clearCookies', 'wsUrl'], (result) => {
        document.getElementById('autoReload').checked = result.autoReload !== undefined ? result.autoReload : true;
        document.getElementById('clearCookies').checked = result.clearCookies !== undefined ? result.clearCookies : true;
        document.getElementById('wsUrl').value = result.wsUrl || 'ws://localhost:8080';
    });
}

// Tab管理功能
function getTabStatus() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_TAB_STATUS' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Error getting tab status:', chrome.runtime.lastError);
                resolve(null);
            } else {
                resolve(response);
            }
        });
    });
}

function formatLastUsed(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}小时前`;
    } else if (minutes > 0) {
        return `${minutes}分钟前`;
    } else {
        return `${seconds}秒前`;
    }
}

function sendTestTask(tabId) {
    const testMessage = `测试任务 - ${new Date().toLocaleTimeString()}`;
    
    chrome.runtime.sendMessage({
        type: 'FORCE_TASK_DISPATCH',
        tabId: tabId,
        task: testMessage
    }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('Error sending test task:', chrome.runtime.lastError);
            alert('发送测试任务失败');
        } else if (response.success) {
            alert('测试任务已发送');
            // 延迟刷新状态
            setTimeout(refreshTabStatus, 500);
        } else {
            alert('发送测试任务失败: ' + response.error);
        }
    });
}

async function refreshTabStatus() {
    const tabsList = document.getElementById('tabsList');
    const wsStatus = document.getElementById('wsStatus');
    
    try {
        const status = await getTabStatus();
        
        if (!status) {
            tabsList.innerHTML = '<div style="color: #dc3545;">无法获取Tab状态信息</div>';
            wsStatus.textContent = '连接状态: 未知';
            wsStatus.className = 'ws-disconnected';
            return;
        }
        
        // 更新WebSocket状态
        wsStatus.textContent = `WebSocket: ${status.wsConnected ? '已连接' : '未连接'}`;
        wsStatus.className = status.wsConnected ? 'ws-connected' : 'ws-disconnected';
        
        // 更新Tab列表
        if (status.tabs.length === 0) {
            tabsList.innerHTML = '<div style="color: #666;">没有活跃的豆包Tab</div>';
        } else {
            const tabsHTML = status.tabs.map(tab => `
                <div class="tab-item">
                    <div class="tab-header">
                        <span class="tab-id">Tab ID: ${tab.id}</span>
                        <span class="tab-status ${tab.status}">${tab.status}</span>
                    </div>
                    <div class="tab-info">
                        URL: ${tab.url}<br>
                        最后使用: ${formatLastUsed(tab.lastUsed)}
                    </div>
                    <div class="tab-actions">
                        <button class="btn-test" onclick="sendTestTask(${tab.id})">
                            发送测试任务
                        </button>
                    </div>
                </div>
            `).join('');
            
            tabsList.innerHTML = tabsHTML;
        }
        
        // 显示队列信息
        if (status.queueLength > 0) {
            const queueInfo = document.createElement('div');
            queueInfo.className = 'queue-info';
            queueInfo.innerHTML = `<strong>任务队列:</strong> ${status.queueLength} 个任务等待处理`;
            tabsList.appendChild(queueInfo);
        }
        
    } catch (error) {
        console.error('Error refreshing tab status:', error);
        tabsList.innerHTML = '<div style="color: #dc3545;">刷新状态时发生错误</div>';
    }
}

// 页面加载时加载设置
document.addEventListener('DOMContentLoaded', () => {
    loadOptions();
    refreshTabStatus();
    
    // 添加刷新按钮事件
    document.getElementById('refreshTabs').addEventListener('click', refreshTabStatus);
    
    // 定期刷新状态
    setInterval(refreshTabStatus, 5000);
});

// 保存按钮事件
document.getElementById('saveButton').addEventListener('click', saveOptions);

// 将sendTestTask函数暴露为全局函数，供HTML中的onclick使用
window.sendTestTask = sendTestTask; 