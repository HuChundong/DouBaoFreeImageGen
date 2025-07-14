import asyncio
import websockets
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional, List, Dict
from enum import Enum

# Assuming FastMCP structure
from fastmcp import FastMCP, Context
import sys  # For Windows event policy

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Server configuration
SERVER_HOST = "0.0.0.0"  # Or '0.0.0.0'
WS_PORT = 8080  # WebSocket Port
MCP_PORT = 8081  # FastMCP HTTP Port (must be different from WS_PORT)


class ClientStatus(Enum):
    IDLE = "idle"
    BUSY = "busy"


@dataclass
class Client:
    """WebSocket客户端信息"""
    id: str
    websocket: websockets.WebSocketServer
    status: ClientStatus = ClientStatus.IDLE
    current_task_id: Optional[str] = None
    last_active: float = field(default_factory=time.time)
    url: Optional[str] = None  # 客户端所在的URL
    
    def update_activity(self):
        """更新客户端活动时间"""
        self.last_active = time.time()


@dataclass
class Task:
    """任务信息"""
    id: str
    prompt: str
    client_id: str
    create_time: float
    timeout: float = 60.0  # 默认60秒超时
    image_urls: List[str] = field(default_factory=list)
    status: str = "pending"  # pending, completed, timeout, error
    
    def is_timeout(self) -> bool:
        """检查任务是否超时"""
        return time.time() - self.create_time > self.timeout


@dataclass
class AppContext:
    """
    应用上下文，包含所有共享资源和状态。
    由 main_async 创建，并通过闭包和 WebSocket handler 共享。
    """
    # 多个WebSocket客户端
    clients: Dict[str, Client] = field(default_factory=dict)
    # 任务管理
    tasks: Dict[str, Task] = field(default_factory=dict)
    # 轮询索引
    round_robin_index: int = 0

    def add_client(self, client_id: str, websocket: websockets.WebSocketServer):
        """添加新客户端"""
        self.clients[client_id] = Client(id=client_id, websocket=websocket)
        logger.info(f"Client {client_id} added. Total clients: {len(self.clients)}")

    def remove_client(self, client_id: str):
        """移除客户端"""
        if client_id in self.clients:
            # 如果客户端有正在进行的任务，标记为错误
            for task in self.tasks.values():
                if task.client_id == client_id and task.status == "pending":
                    task.status = "error"
                    logger.warning(f"Task {task.id} marked as error due to client disconnect")
            
            del self.clients[client_id]
            logger.info(f"Client {client_id} removed. Total clients: {len(self.clients)}")

    def get_idle_client(self) -> Optional[Client]:
        """使用轮询策略获取空闲客户端"""
        if not self.clients:
            return None
        
        client_ids = list(self.clients.keys())
        if not client_ids:
            return None
            
        # 从当前轮询索引开始查找空闲客户端
        start_index = self.round_robin_index
        for i in range(len(client_ids)):
            index = (start_index + i) % len(client_ids)
            client_id = client_ids[index]
            client = self.clients[client_id]
            
            # 检查客户端状态和连接状态
            if (client.status == ClientStatus.IDLE and 
                hasattr(client.websocket, "state") and 
                client.websocket.state == websockets.State.OPEN):
                # 更新轮询索引到下一个客户端
                self.round_robin_index = (index + 1) % len(client_ids)
                return client
        
        return None

    def set_client_busy(self, client_id: str, task_id: str):
        """设置客户端为忙碌状态"""
        if client_id in self.clients:
            self.clients[client_id].status = ClientStatus.BUSY
            self.clients[client_id].current_task_id = task_id
            self.clients[client_id].update_activity()

    def set_client_idle(self, client_id: str):
        """设置客户端为空闲状态"""
        if client_id in self.clients:
            self.clients[client_id].status = ClientStatus.IDLE
            self.clients[client_id].current_task_id = None
            self.clients[client_id].update_activity()

    def handle_script_ready(self, client_id: str, url: str):
        """处理客户端脚本准备就绪事件"""
        if client_id in self.clients:
            self.clients[client_id].url = url
            self.clients[client_id].update_activity()
            logger.info(f"Client {client_id} script ready at {url}")

    def create_task(self, prompt: str, client_id: str) -> Task:
        """创建新任务"""
        task_id = str(uuid.uuid4())
        task = Task(
            id=task_id,
            prompt=prompt,
            client_id=client_id,
            create_time=time.time()
        )
        self.tasks[task_id] = task
        return task

    def complete_task(self, task_id: str, image_urls: List[str]):
        """完成任务"""
        if task_id in self.tasks:
            task = self.tasks[task_id]
            task.image_urls = image_urls
            task.status = "completed"
            self.set_client_idle(task.client_id)
            logger.info(f"Task {task_id} completed with {len(image_urls)} images")

    def timeout_task(self, task_id: str):
        """任务超时"""
        if task_id in self.tasks:
            task = self.tasks[task_id]
            task.status = "timeout"
            self.set_client_idle(task.client_id)
            logger.warning(f"Task {task_id} timed out")

    def check_timeouts(self):
        """检查并处理超时任务"""
        for task in self.tasks.values():
            if task.status == "pending" and task.is_timeout():
                self.timeout_task(task.id)

    def cleanup_old_tasks(self, max_age_hours: float = 24):
        """清理旧任务，释放内存"""
        current_time = time.time()
        max_age_seconds = max_age_hours * 3600
        
        tasks_to_remove = []
        for task_id, task in self.tasks.items():
            if current_time - task.create_time > max_age_seconds:
                tasks_to_remove.append(task_id)
        
        for task_id in tasks_to_remove:
            del self.tasks[task_id]
            logger.info(f"Cleaned up old task {task_id}")
        
        if tasks_to_remove:
            logger.info(f"Cleaned up {len(tasks_to_remove)} old tasks")

    def cleanup_disconnected_clients(self):
        """清理已断开连接的客户端"""
        clients_to_remove = []
        for client_id, client in self.clients.items():
            if (hasattr(client.websocket, "state") and 
                client.websocket.state != websockets.State.OPEN):
                clients_to_remove.append(client_id)
        
        for client_id in clients_to_remove:
            logger.info(f"Removing disconnected client {client_id}")
            self.remove_client(client_id)

    async def handle_image_url_event(self, client_id: str, urls: List[str]):
        """
        处理从 WebSocket 客户端接收到的图像 URL 事件。
        """
        # 找到该客户端当前的任务
        client = self.clients.get(client_id)
        if not client or not client.current_task_id:
            logger.warning(f"Client {client_id} sent image URLs but has no current task")
            return

        task_id = client.current_task_id
        if task_id in self.tasks:
            self.complete_task(task_id, urls)
        else:
            logger.warning(f"Task {task_id} not found for client {client_id}")


# --- WebSocket Server Handler ---
async def websocket_handler(websocket, app_context: AppContext):
    """
    Handles a single WebSocket connection.
    """
    # 生成客户端ID
    client_id = str(uuid.uuid4())
    logger.info(f"Client {client_id} connected from {websocket.remote_address}")

    # 添加客户端到上下文
    app_context.add_client(client_id, websocket)

    try:
        async for message in websocket:
            logger.info(f"Received from client {client_id}: {message[:200]}...")

            try:
                data = json.loads(message)

                # Handle image URL messages
                if isinstance(data, dict) and data.get("type") == "collectedImageUrls":
                    image_urls = data.get("urls")
                    if image_urls:
                        await app_context.handle_image_url_event(client_id, image_urls)
                        continue

                # Handle script ready messages
                if isinstance(data, dict) and data.get("type") == "scriptReady":
                    url = data.get("url")
                    if url:
                        app_context.handle_script_ready(client_id, url)
                        continue

                logger.warning(
                    f"Unknown message type received from {client_id}: {data.get('type')} - Data: {data}"
                )

            except json.JSONDecodeError:
                logger.warning(f"Received non-JSON message from {client_id}: {message[:200]}...")
            except Exception as e:
                logger.error(f"Error processing message from {client_id}: {e}", exc_info=True)

    except websockets.exceptions.ConnectionClosedOK:
        logger.info(f"Client {client_id} disconnected cleanly")
    except websockets.exceptions.ConnectionClosedError as e:
        logger.warning(f"Client {client_id} disconnected with error: {e}")
    except Exception as e:
        logger.error(f"Unexpected error in handler for {client_id}: {e}", exc_info=True)
    finally:
        logger.info(f"Client {client_id} handler ending")
        app_context.remove_client(client_id)


async def send_to_client(websocket, message: str):
    """Helper function to send a message to the client."""
    try:
        # Check state if available, prefer not sending if not open
        if hasattr(websocket, "state") and websocket.state != websockets.State.OPEN:
            state_info = str(websocket.state)
            logger.warning(f"Attempted to send to client in state {state_info}")
            return False

        await websocket.send(message)
        logger.debug(f"Successfully sent message to client: {message[:100]}...")
        return True
    except websockets.exceptions.ConnectionClosed as e:
        logger.warning(f"Connection closed when sending to client: {e}")
        return False
    except Exception as e:
        logger.error(f"Error sending to client: {e}", exc_info=True)
        return False


# --- Main Async Entry Point ---
async def main_async():
    """
    Main async function to initialize and run both services
    within the same asyncio event loop.
    """
    logger.info("Starting application: WebSocket and FastMCP services...")

    # Create the single shared application context instance
    app_context = AppContext()
    logger.info("Shared AppContext instance created.")

    # --- Create and Configure the FastMCP Instance ---
    mcp = FastMCP(
        name="WebSocketMCP",
        instructions=f"""
        This MCP instance provides tools to interact with the WebSocket layer.
        The WebSocket server listens on ws://{SERVER_HOST}:{WS_PORT}.
        The MCP server (HTTP) listens on http://{SERVER_HOST}:{MCP_PORT}.

        You can send commands to the connected WebSocket clients using the 'draw_image' tool.
        The tool will use round-robin strategy to distribute tasks among idle clients.
        """,
        json_response=True,
    )
    logger.info("FastMCP instance created.")

    @mcp.tool()
    async def draw_image(ctx: Context, prompt: str) -> str:
        """
        Generate an image based on the provided text prompt.

        Args:
            prompt (str): Text description of the image to generate. Must be a non-empty string.

        Returns:
            str: JSON string with the following structure:
                - On success: {"status": "success", "image_urls": ["url1", "url2", ...]}
                - On error: {"status": "error", "message": "error description"}
                
        Limitations:
            - Requires at least one connected WebSocket client
            - Maximum processing time: 60 seconds
            - Returns error if no idle clients are available
        """
        try:
            # 验证输入参数
            if not prompt or not prompt.strip():
                return json.dumps(
                    {"status": "error", "message": "Prompt cannot be empty"},
                    ensure_ascii=False,
                )
            
            # 检查超时任务
            app_context.check_timeouts()
            
            # 清理断开连接的客户端
            app_context.cleanup_disconnected_clients()
            
            # 定期清理旧任务（如果有超过50个任务时）
            if len(app_context.tasks) > 50:
                app_context.cleanup_old_tasks()
            
            # 获取空闲客户端
            idle_client = app_context.get_idle_client()
            if not idle_client:
                return json.dumps(
                    {"status": "error", "message": "No idle WebSocket clients available"},
                    ensure_ascii=False,
                )

            task = None
            try:
                # 创建任务
                task = app_context.create_task(prompt, idle_client.id)
                
                # 设置客户端为忙碌状态
                app_context.set_client_busy(idle_client.id, task.id)

                # 发送任务到客户端
                success = await send_to_client(idle_client.websocket, prompt)
                if not success:
                    # 发送失败，恢复客户端状态
                    app_context.set_client_idle(idle_client.id)
                    task.status = "error"
                    return json.dumps(
                        {"status": "error", "message": "Failed to send task to client"},
                        ensure_ascii=False,
                    )

                logger.info(f"Task {task.id} sent to client {idle_client.id}: {prompt}")

                # 等待任务完成
                max_wait_time = task.timeout
                poll_interval = 1
                start_time = time.time()

                while time.time() - start_time < max_wait_time:
                    # 检查任务状态
                    current_task = app_context.tasks.get(task.id)
                    if not current_task:
                        logger.warning(f"Task {task.id} disappeared from task list")
                        break
                    
                    if current_task.status == "completed":
                        logger.info(f"Task {task.id} completed successfully")
                        return json.dumps(
                            {"status": "success", "image_urls": current_task.image_urls},
                            ensure_ascii=False,
                        )
                    elif current_task.status in ["timeout", "error"]:
                        logger.warning(f"Task {task.id} failed with status: {current_task.status}")
                        return json.dumps(
                            {
                                "status": "error",
                                "message": f"Task {current_task.status}",
                                "received_urls": current_task.image_urls,
                            },
                            ensure_ascii=False,
                        )

                    await asyncio.sleep(poll_interval)

                # 手动超时处理
                logger.warning(f"Task {task.id} timed out after {max_wait_time} seconds")
                app_context.timeout_task(task.id)
                return json.dumps(
                    {
                        "status": "error",
                        "message": "Task timeout",
                        "received_urls": task.image_urls if task else [],
                    },
                    ensure_ascii=False,
                )

            except asyncio.CancelledError:
                # 任务被取消（通常是客户端断开连接）
                logger.warning(f"Task {task.id if task else 'unknown'} was cancelled, likely due to client disconnect")
                if task:
                    app_context.timeout_task(task.id)
                return json.dumps(
                    {"status": "error", "message": "Task cancelled due to client disconnect"},
                    ensure_ascii=False,
                )
            except Exception as e:
                logger.error(f"Error in draw_image task processing for task {task.id if task else 'unknown'}: {e}", exc_info=True)
                # 确保客户端状态恢复
                if task:
                    app_context.set_client_idle(idle_client.id)
                    task.status = "error"
                return json.dumps(
                    {"status": "error", "message": f"Internal error: {str(e)}"},
                    ensure_ascii=False,
                )
        
        except Exception as e:
            logger.error(f"Error in draw_image function: {e}", exc_info=True)
            return json.dumps(
                {"status": "error", "message": f"Function error: {str(e)}"},
                ensure_ascii=False,
            )

    @mcp.tool()
    def get_connection_status(ctx: Context) -> str:
        """
        Get the current WebSocket connection status.

        Returns:
            str: JSON string containing connection status.
        """
        try:
            app_context.check_timeouts()
            
            client_info = []
            for client_id, client in app_context.clients.items():
                try:
                    is_connected = (hasattr(client.websocket, "state") and 
                                  client.websocket.state == websockets.State.OPEN)
                except Exception:
                    is_connected = False
                
                client_info.append({
                    "id": client_id,
                    "connected": is_connected,
                    "status": client.status.value,
                    "current_task": client.current_task_id,
                    "last_active": client.last_active,
                    "url": client.url
                })
            
            task_info = []
            for task_id, task in app_context.tasks.items():
                task_info.append({
                    "id": task_id,
                    "client_id": task.client_id,
                    "status": task.status,
                    "create_time": task.create_time,
                    "image_count": len(task.image_urls)
                })
            
            return json.dumps(
                {
                    "total_clients": len(app_context.clients),
                    "clients": client_info,
                    "total_tasks": len(app_context.tasks),
                    "tasks": task_info
                },
                ensure_ascii=False,
            )
        except Exception as e:
            logger.error(f"Error in get_connection_status: {e}", exc_info=True)
            return json.dumps(
                {
                    "status": "error",
                    "message": f"Failed to get connection status: {str(e)}"
                },
                ensure_ascii=False,
            )

    # --- Start WebSocket Server ---
    ws_server = await websockets.serve(
        lambda websocket: websocket_handler(websocket, app_context),
        SERVER_HOST,
        WS_PORT,
    )
    logger.info(f"WebSocket server started on ws://{SERVER_HOST}:{WS_PORT}")

    # --- Start FastMCP Server ---
    mcp_server_task = asyncio.create_task(
        mcp.run_async(transport="streamable-http", host=SERVER_HOST, port=MCP_PORT)
    )
    logger.info(f"FastMCP server started on http://{SERVER_HOST}:{MCP_PORT}")

    logger.info("Both servers started. Press Ctrl+C to stop.")

    # --- Run Both Servers Concurrently ---
    server_tasks = [asyncio.create_task(ws_server.wait_closed()), mcp_server_task]

    try:
        await asyncio.gather(*server_tasks)
    except asyncio.CancelledError:
        logger.info("Application tasks were cancelled.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}", exc_info=True)
    finally:
        logger.info("Application shutting down...")
        ws_server.close()
        await ws_server.wait_closed()
        logger.info("Application shutdown complete.")


def main():
    """Entry point to run the async main function."""
    if sys.platform == "win32":
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
            logger.info("Using WindowsSelectorEventLoopPolicy on Windows.")
        except AttributeError:
            logger.warning(
                "WindowsSelectorEventLoopPolicy not available, using default."
            )

    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        logger.info("Application interrupted by user (Ctrl+C).")
    except Exception as e:
        logger.error(f"An error occurred: {e}", exc_info=True)


if __name__ == "__main__":
    main()
