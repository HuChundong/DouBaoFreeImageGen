![DouBaoFreeImageGen Logo](assets/logo.png)

# DouBaoFreeImageGen

DouBaoFreeImageGen 是一个基于 FastMCP 框架的智能文生图服务，通过浏览器插件与豆包客户端深度集成，提供高效的 MCP (Model Context Protocol) 服务接口，支持无限次调用豆包的文生图功能。

## 核心特性

- 🚀 **FastMCP 框架**：基于现代 MCP 协议，提供标准化的服务接口
- 🔄 **多客户端支持**：支持多个浏览器实例同时连接，智能负载均衡
- ⚡ **高效任务调度**：轮询算法分配任务，支持并发处理
- 🛡️ **可靠性保障**：任务超时管理、自动重连、连接状态监控
- 🎨 **图片管理**：内置图片收集、预览、批量下载功能
- 📊 **实时监控**：完整的连接状态和任务状态查询接口
- 🔧 **灵活配置**：支持自动刷新、Cookie 管理等个性化设置

## 系统架构

### 核心组件

1. **MCP 服务器** (`McpServer/`)
   - FastMCP 框架提供标准 MCP 接口
   - WebSocket 服务器处理浏览器插件连接
   - 任务队列管理和负载均衡
   - 连接状态监控和异常处理

2. **浏览器插件** (`DoubaoMcpBrowserProxy/`)
   - Chrome 扩展，集成豆包客户端
   - 自动化文生图指令输入
   - 图片 URL 实时收集和监控
   - 用户界面增强功能

## 演示视频

https://github.com/user-attachments/assets/98ed6c08-1252-4976-90ed-53440ef13280

## 系统要求

- **Python**: 3.8 或更高版本
- **浏览器**: 支持 Chrome 扩展的 Chromium 内核浏览器
- **豆包客户端**: 最新版本
- **操作系统**: Windows / macOS / Linux

## 快速开始

### 1. 项目安装

```bash
# 克隆项目
git clone https://github.com/yourusername/DouBaoFreeImageGen.git
cd DouBaoFreeImageGen

# 安装 Python 依赖
cd McpServer
pip install -r requirements.txt
```

### 2. 安装浏览器插件

#### 方法一：直接安装 (推荐)
1. 将 `DoubaoMcpBrowserProxy.crx` 文件拖拽到浏览器扩展页面 (`chrome://extensions/`)

#### 方法二：开发者模式安装
1. 打开浏览器扩展页面 (`chrome://extensions/`)
2. 开启右上角的"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `DoubaoMcpBrowserProxy` 目录

### 3. 配置豆包客户端

为获得最佳体验，建议在豆包客户端快捷方式中添加启动参数：

```
"豆包客户端路径" --silent-debugger-extension-api
```

示例：
```
"C:\Program Files\Doubao\app\Doubao.exe" --silent-debugger-extension-api
```

### 4. 启动服务

```bash
# 在 McpServer 目录下启动服务
python server.py
```

服务启动后将提供：
- **WebSocket 服务**: `ws://localhost:8080` (浏览器插件连接)
- **MCP 服务**: `http://localhost:8081` (MCP 客户端连接)

> **注意**: 如果部署在服务器上，请将 `localhost` 替换为实际的服务器IP地址，并确保防火墙允许相应端口的访问。

## 使用指南

### MCP 客户端接入

#### 配置 MCP 服务地址

在 MCP 客户端中配置服务地址：
```
http://192.168.2.192:8081/mcp
```

#### 1. 文生图接口

**工具名称**: `draw_image`

**参数**:
- `prompt` (string): 文生图提示词

**返回格式**:
```json
{
    "status": "success",
    "image_urls": ["https://...", "https://..."]
}
```

**使用示例**:
```python
import requests

# 调用文生图接口
response = requests.post(
    'http://localhost:8081/tools/draw_image',
    json={'prompt': '一只可爱的小猫在花园里玩耍'}
)

result = response.json()
if result['status'] == 'success':
    print(f"生成了 {len(result['image_urls'])} 张图片")
    for url in result['image_urls']:
        print(f"图片地址: {url}")
```

#### 2. 连接状态查询

**工具名称**: `get_connection_status`

**返回信息**:
- 连接的客户端数量和状态
- 当前任务队列情况
- 系统运行状态

### 浏览器插件功能

#### 自动化操作
- 自动接收 MCP 服务器发送的文生图指令
- 模拟用户在豆包客户端中输入提示词
- 实时监控生成的图片并收集 URL

#### 图片管理
- **实时预览**: 弹窗显示所有收集到的图片
- **单独下载**: 选择特定图片进行下载
- **批量下载**: 一键下载所有图片
- **列表管理**: 清空图片列表，重新开始收集

#### 个性化设置
在插件选项页面 (`chrome://extensions/` → 插件详情 → 扩展程序选项) 中可配置：

- **自动刷新**: 任务完成后是否自动刷新页面
- **Cookie 管理**: 是否自动清除 Cookie (保持匿名状态)

## 高级配置

### 服务器配置

在 `McpServer/server.py` 中可调整以下参数：

```python
# 服务器配置
SERVER_HOST = "0.0.0.0"  # 服务器监听地址
WS_PORT = 8080           # WebSocket 端口
MCP_PORT = 8081          # MCP 服务端口

# 任务配置
DEFAULT_TIMEOUT = 60.0   # 默认任务超时时间(秒)
MAX_TASKS = 50          # 任务队列最大长度
```

### 任务管理策略

- **轮询负载均衡**: 任务自动分配给空闲客户端
- **超时保护**: 60秒任务超时，自动释放资源
- **状态监控**: 实时监控客户端连接和任务状态
- **异常恢复**: 客户端断开时自动清理相关任务

## API 详细文档

### MCP Tools

#### `draw_image`
生成图片的核心工具

**参数验证**:
- `prompt` 不能为空或仅包含空白字符
- 需要至少一个空闲的浏览器客户端连接

**处理流程**:
1. 验证输入参数
2. 检查可用客户端
3. 创建任务并分配给空闲客户端
4. 发送指令到浏览器
5. 等待图片生成完成
6. 返回图片 URL 列表

**错误处理**:
- 无可用客户端: `"No idle WebSocket clients available"`
- 任务超时: `"Task timeout"`
- 客户端断开: `"Task cancelled due to client disconnect"`

#### `get_connection_status`
获取系统状态信息

**返回数据结构**:
```json
{
    "total_clients": 2,
    "clients": [
        {
            "id": "client-uuid",
            "connected": true,
            "status": "idle",
            "current_task": null,
            "last_active": 1703123456.789,
            "url": "https://www.doubao.com/chat/"
        }
    ],
    "total_tasks": 5,
    "tasks": [
        {
            "id": "task-uuid",
            "client_id": "client-uuid", 
            "status": "completed",
            "create_time": 1703123456.789,
            "image_count": 3
        }
    ]
}
```

## 故障排除

### 常见问题

1. **插件无法连接服务器**
   - 检查服务器是否启动 (`python server.py`)
   - 确认端口 8080 未被占用
   - 检查防火墙设置

2. **任务超时或失败**
   - 确保豆包客户端正常运行
   - 检查网络连接稳定性
   - 尝试重新刷新豆包页面

3. **图片无法下载**
   - 检查浏览器下载权限
   - 确认图片 URL 有效性
   - 尝试清除浏览器缓存

### 日志调试

查看服务器日志：
```bash
# 服务器日志会显示详细的连接和任务信息
python server.py
```

查看浏览器控制台：
```javascript
// 在豆包页面按F12，查看Console输出
// 搜索 "[Script]" 或 "[WebSocket]" 相关日志
```

## 注意事项与限制

### 使用须知

⚠️ **重要提示**：
1. **隐私保护**: 插件会自动清除 Cookie，每次使用都是匿名状态
2. **页面刷新**: 为确保功能正常，插件可能会自动刷新豆包页面
3. **单任务限制**: 每个客户端同时只能处理一个文生图任务
4. **网络依赖**: 需要稳定的网络连接以确保服务正常

### 法律与合规

- 本项目仅供学习研究使用
- 请遵守豆包服务条款和使用协议
- 禁止用于任何商业用途
- 禁止生成违法违规内容

### 性能考虑

- 建议同时连接客户端数量不超过 5 个
- 大量并发请求可能影响豆包服务稳定性
- 定期重启服务以清理资源占用

## 开发指南

### 项目结构
```
DouBaoFreeImageGen/
├── McpServer/              # MCP 服务器
│   ├── server.py          # 主服务文件
│   ├── requirements.txt   # Python 依赖
│   └── docker-compose.yml # Docker 配置
├── DoubaoMcpBrowserProxy/ # 浏览器插件
│   ├── manifest.json     # 插件配置
│   ├── content.js        # 内容脚本
│   ├── background.js     # 后台脚本
│   └── options.html      # 设置页面
└── README.md
```

### 贡献代码

欢迎提交 Issue 和 Pull Request！贡献前请确保：

1. 代码符合项目规范
2. 添加必要的测试用例
3. 更新相关文档
4. 通过所有现有测试

## 开源协议

本项目采用 MIT 协议开源。详情请查看 [LICENSE](LICENSE) 文件。

## 免责声明

本项目仅供学习和研究使用，请勿用于商业用途。使用本项目产生的任何后果由使用者自行承担。作者不对项目造成的任何损失承担责任。

## 致谢

感谢豆包强大的文生图模型为本项目提供技术支持。

## Star History

<a href="https://www.star-history.com/#HuChundong/DouBaoFreeImageGen&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=HuChundong/DouBaoFreeImageGen&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=HuChundong/DouBaoFreeImageGen&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=HuChundong/DouBaoFreeImageGen&type=Date" />
 </picture>
</a>