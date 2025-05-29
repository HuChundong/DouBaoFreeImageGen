// Function to clear all cookies
async function clearAllCookies() {
  console.log("Clearing all cookies");
  try {
    const allCookies = await chrome.cookies.getAll({});
    for (const cookie of allCookies) {
      const protocol = cookie.secure ? "https:" : "http:";
      const cookieUrl = `${protocol}//${cookie.domain.replace(/^\./, "")}${cookie.path}`;
      await chrome.cookies.remove({
        url: cookieUrl,
        name: cookie.name,
        storeId: cookie.storeId
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
    if (details.frameId === 0) { // 只处理主框架
      await clearAllCookies();
    }
  },
  { url: [{ schemes: ["http", "https"] }] }
);

// 安装或更新时清除cookie
chrome.runtime.onInstalled.addListener(clearAllCookies); 