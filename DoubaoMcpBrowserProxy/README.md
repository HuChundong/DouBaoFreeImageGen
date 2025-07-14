# 豆包助手浏览器代理

这是一个Chrome浏览器扩展，用于自动化豆包网站的交互，支持多tab管理和任务分发。

## 功能特性

### 🔄 多Tab管理
- **智能tab检测**: 自动检测和管理所有打开的豆包tab
- **轮询任务分发**: 使用轮询策略将任务分发到空闲的tab
- **任务队列**: 当所有tab都忙碌时，任务会被加入队列等待处理
- **状态监控**: 实时监控每个tab的状态（空闲/忙碌）

### 🌐 WebSocket连接
- **单一连接**: 无论开启多少个tab，只维护一个WebSocket连接
- **自动重连**: 连接断开时自动重连
- **消息路由**: 根据任务类型和tab状态智能路由消息

### 🖼️ 图片拦截
- **EventStream拦截**: 自动拦截豆包的图片生成结果
- **去重处理**: 自动去除重复的图片URL
- **批量下载**: 支持无水印图片的批量下载

### ⚙️ 设置管理
- **灵活配置**: 支持自动刷新、Cookie清理等选项
- **实时监控**: 在设置页面查看所有tab的实时状态
- **测试功能**: 可以向指定tab发送测试任务

## 使用方法

### 1. 安装扩展
1. 下载扩展文件
2. 打开Chrome的扩展管理页面
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择扩展文件夹

### 2. 配置设置
1. 右键点击扩展图标，选择"选项"
2. 配置WebSocket服务器地址（默认: ws://localhost:8080）
3. 设置自动刷新和Cookie清理选项

### 3. 多Tab使用
1. 打开多个豆包tab (https://www.doubao.com)
2. 扩展会自动检测并管理所有tab
3. 任务会根据轮询策略分发到空闲的tab

### 4. 监控管理
1. 在设置页面查看"Tab管理"部分
2. 可以看到所有tab的状态和最后使用时间
3. 支持向指定tab发送测试任务
4. 实时显示任务队列长度和WebSocket连接状态

## 任务分发策略

### 轮询分发
- 系统维护一个轮询索引
- 从空闲tab中按轮询顺序选择
- 确保任务均匀分发到所有tab

### 状态管理
- **idle**: tab空闲，可以接收新任务
- **busy**: tab正在处理任务
- 任务完成后自动切换回idle状态

### 队列处理
- 当所有tab都忙碌时，任务加入队列
- 有tab变为空闲时，自动处理队列中的任务
- 支持查看队列长度和状态

## 技术实现

### 架构设计
```
WebSocket Server ↔ Background Script ↔ Content Scripts (多个Tab)
                                    ↕
                                Task Queue
```

### 消息类型
- `COMMAND_FROM_SERVER`: 服务器发送的命令
- `TASK_COMPLETED`: 任务完成通知
- `TAB_STATUS_UPDATE`: tab状态更新
- `GET_TAB_STATUS`: 获取所有tab状态
- `FORCE_TASK_DISPATCH`: 强制分发任务到指定tab

### 数据结构
```javascript
// Tab信息
{
  id: tabId,
  url: string,
  status: 'idle' | 'busy',
  lastUsed: timestamp
}

// 任务队列
taskQueue = [task1, task2, ...];
```

## 故障排除

### 常见问题

1. **WebSocket连接失败**
   - 检查服务器地址是否正确
   - 确保后端服务正在运行
   - 查看浏览器控制台的错误信息

2. **任务分发不均匀**
   - 检查tab状态是否正确更新
   - 确认任务完成后是否正确通知
   - 查看任务队列状态

3. **图片拦截失败**
   - 检查是否在豆包官网
   - 确认调试器是否正确附加
   - 查看Network面板的EventStream请求

### 调试方法

1. **查看日志**
   ```javascript
   // 在浏览器控制台查看
   console.log("[Background]", "信息");
   console.log("[Content]", "信息");
   console.log("[TaskManager]", "信息");
   ```

2. **检查存储**
   ```javascript
   // 查看扩展设置
   chrome.storage.sync.get(null, console.log);
   ```

3. **监控WebSocket**
   ```javascript
   // 检查连接状态
   ws.readyState; // 0: CONNECTING, 1: OPEN, 2: CLOSING, 3: CLOSED
   ```

## 开发说明

### 文件结构
```
DoubaoMcpBrowserProxy/
├── background.js    # 后台脚本 - 主要逻辑
├── content.js      # 内容脚本 - 页面交互
├── options.html    # 设置页面
├── options.js      # 设置页面逻辑
├── manifest.json   # 扩展配置
└── README.md      # 文档
```

### 开发环境
- Chrome Extension Manifest V2
- JavaScript ES6+
- Chrome APIs (tabs, debugger, storage, runtime)

### 扩展功能
如需增加新功能，可以：
1. 在background.js中添加新的消息处理逻辑
2. 在content.js中添加新的页面交互功能
3. 在options页面添加新的设置选项
4. 更新manifest.json中的权限配置

## 许可证

MIT License 