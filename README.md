![DouBaoFreeImageGen Logo](assets/logo.png)

# DouBaoFreeImageGen

DouBaoFreeImageGen 是一个基于豆包客户端的文生图 MCP 服务，可以无限次调用豆包的文生图功能，并对外提供 MCP 服务接口。

## 功能特性

- 🎨 可能无限次调用豆包文生图功能
- 🔌 提供不标准的 MCP 服务接口
- ⚡ 异步处理，低性能响应
- 🔒 不支持任务状态管理和并发控制
- 📝 不完整的日志记录系统

## 演示视频

https://github.com/user-attachments/assets/98ed6c08-1252-4976-90ed-53440ef13280

## 系统要求

- Python 3.8+
- 操作系统（支持豆包客户端即可）
- 豆包客户端

## 安装说明

⚠️ **重要提示**：安装浏览器插件后将会影响豆包客户端的正常使用（每次都会移除cookie,不保留聊天记录，生成图片会自动重新加载），建议在独立的服务器或虚拟机上进行部署。

1. 克隆项目到本地：
```bash
git clone https://github.com/yourusername/DouBaoFreeImageGen.git
cd DouBaoFreeImageGen
```

2. 安装依赖：

```bash
cd McpServer
pip install -r requirements.txt
```

3. 安装浏览器插件：

   a. 打开豆包客户端，进入扩展程序页面（在地址栏输入 `chrome://extensions/`）
   
   b. 开启右上角的"开发者模式"
   
   c. 选择以下任一方式安装插件：
      - 方式一：将项目中的 `DoubaoMcpBrowserProxy.crx` 文件拖拽到扩展程序页面
      - 方式二：点击"加载已解压的扩展程序"，选择项目中的 `DoubaoMcpBrowserProxy` 目录

4. 安装完成后，确保插件已启用（插件图标显示在浏览器工具栏中）

## 使用方法

1. 启动服务：
```bash
python McpServer/server.py
```

2. 服务将在以下地址启动：
   - WebSocket 服务：`ws://localhost:8080`
   - MCP HTTP 服务：`http://localhost:8000`

3. 通过 MCP 接口调用文生图功能：
```python
# 示例代码
import requests

response = requests.post('http://localhost:8000/draw_image', 
    json={'command': '你的文生图提示词'})
print(response.json())
```

## API 文档

### 1. 文生图接口

- **端点**：`/draw_image`
- **方法**：POST
- **参数**：
  - `command`：文生图提示词
- **返回**：
  ```json
  {
    "status": "success",
    "image_urls": ["图片URL1", "图片URL2", ...]
  }
  ```

### 2. 连接状态查询

- **端点**：`/get_connection_status`
- **方法**：GET
- **返回**：
  ```json
  {
    "connected": true,
    "received_images": 0
  }
  ```

## 注意事项

1. 使用前请确保豆包客户端没有登录，每次生成都会移除cookie
2. 服务启动时会自动连接到豆包客户端
3. 每个文生图任务有 90 秒的超时限制
4. 同一时间只能执行一个文生图任务

## 风险提示

⚠️ **重要提示**：使用本项目时请注意以下风险：

1. **法律风险**
   - 本项目仅供学习和研究使用
   - 请确保遵守豆包的服务条款和使用协议
   - 不得用于任何商业用途
   - 不得用于生成违法、违规或不当内容

2. **技术风险**
   - 项目可能随时因豆包客户端的更新而失效
   - 不保证服务的稳定性和可用性
   - 可能存在安全漏洞，请谨慎使用
   - 建议在隔离环境中运行

3. **使用限制**
   - 禁止用于大规模自动化生成
   - 禁止用于绕过豆包的使用限制
   - 禁止用于任何形式的商业用途
   - 禁止用于生成违反法律法规的内容

4. **免责声明**
   - 作者不对使用本项目产生的任何后果负责
   - 使用者需自行承担所有风险
   - 作者保留随时终止项目维护的权利
   - 作者不对项目造成的任何损失负责

## 贡献指南

欢迎提交 Issue 和 Pull Request 来帮助改进项目。在提交代码前，请确保：

1. 代码符合项目的编码规范
2. 添加了必要的测试
3. 更新了相关文档

## 开源协议

本项目采用 MIT 协议开源。详情请查看 [LICENSE](LICENSE) 文件。

## 免责声明

本项目仅供学习和研究使用，请勿用于商业用途。使用本项目产生的任何后果由使用者自行承担。

## 联系方式

如有问题或建议，请通过以下方式联系：

- 提交 Issue

## 致谢

豆包强大的文生图模型。 
