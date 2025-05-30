// 保存设置到 Chrome 存储
function saveOptions() {
    const autoReload = document.getElementById('autoReload').checked;
    const clearCookies = document.getElementById('clearCookies').checked;
    chrome.storage.sync.set({ 
        autoReload,
        clearCookies
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
    chrome.storage.sync.get(['autoReload', 'clearCookies'], (result) => {
        document.getElementById('autoReload').checked = result.autoReload !== undefined ? result.autoReload : true;
        document.getElementById('clearCookies').checked = result.clearCookies !== undefined ? result.clearCookies : true;
    });
}

// 监听设置变化
document.getElementById('autoReload').addEventListener('change', saveOptions);
document.getElementById('clearCookies').addEventListener('change', saveOptions);

// 页面加载时加载设置
document.addEventListener('DOMContentLoaded', loadOptions); 