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

// 页面加载时加载设置
document.addEventListener('DOMContentLoaded', loadOptions);
// 保存按钮事件
document.getElementById('saveButton').addEventListener('click', saveOptions); 