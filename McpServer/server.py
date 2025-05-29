import asyncio
import websockets
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Optional, List

# Assuming FastMCP structure
from fastmcp import FastMCP, Context
import sys  # For Windows event policy

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Server configuration
SERVER_HOST = "localhost"  # Or '0.0.0.0'
WS_PORT = 8080  # WebSocket Port
MCP_PORT = 8000  # FastMCP HTTP Port (must be different from WS_PORT)


@dataclass
class AppContext:
    """
    应用上下文，包含所有共享资源和状态。
    由 main_async 创建，并通过闭包和 WebSocket handler 共享。
    """

    # Single WebSocket client
    websocket: Optional[websockets.WebSocketServer] = None
    # List to store received image URLs
    image_urls: List[str] = field(default_factory=list)

    has_task: bool = False

    async def handle_image_url_event(self, urls: List[str]):
        """
        处理从 WebSocket 客户端接收到的图像 URL 事件。
        """
        self.image_urls.extend(urls)
        logger.info(f"Received image URLs: {urls} (Total: {len(self.image_urls)})")


# --- WebSocket Server Handler ---
async def websocket_handler(websocket, app_context: AppContext):
    """
    Handles a single WebSocket connection.
    """
    logger.info(f"Client connected from {websocket.remote_address}")

    # Store the single WebSocket connection
    app_context.websocket = websocket

    try:
        async for message in websocket:
            logger.info(f"Received from {websocket.remote_address}: {message[:200]}...")

            try:
                data = json.loads(message)

                # Handle image URL messages
                if isinstance(data, dict) and data.get("type") == "collectedImageUrls":
                    image_urls = data.get("urls")
                    if image_urls:
                        await app_context.handle_image_url_event(image_urls)
                        continue

                logger.warning(
                    f"Unknown message type received: {data.get('type')} - Data: {data}"
                )

            except json.JSONDecodeError:
                logger.warning(f"Received non-JSON message: {message[:200]}...")
            except Exception as e:
                logger.error(f"Error processing message: {e}", exc_info=True)

    except websockets.exceptions.ConnectionClosedOK:
        logger.info(f"Client disconnected cleanly")
    except websockets.exceptions.ConnectionClosedError as e:
        logger.warning(f"Client disconnected with error: {e}")
    except Exception as e:
        logger.error(f"Unexpected error in handler: {e}", exc_info=True)
    finally:
        logger.info("Client handler ending")
        # app_context.websocket = None
        # app_context.image_urls.clear()


async def send_to_client(websocket, message: str):
    """Helper function to send a message to the client."""
    try:
        # Check state if available, prefer not sending if not open
        if hasattr(websocket, "state") and websocket.state != websockets.State.OPEN:
            state_info = str(websocket.state)
            logger.warning(f"Attempted to send to client in state {state_info}")
            return

        await websocket.send(message)
    except Exception as e:
        logger.error(f"Error sending to client: {e}", exc_info=True)


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

        You can send commands to the connected WebSocket client using the 'send_command' tool.
        The tool will poll for image URLs until 4 images are received or timeout occurs.
        """,
        json_response=True,
    )
    logger.info("FastMCP instance created.")

    @mcp.tool()
    async def draw_image(ctx: Context, command: str) -> str:
        """
        Draw an image.

        Args:
            command (str): The command string to send to the client.

        Returns:
            str: JSON string containing the status and list of image URLs.
        """
        if not app_context.websocket:
            return json.dumps(
                {"status": "error", "message": "No WebSocket client connected"},
                ensure_ascii=False,
            )

        # 检查是否有正在执行的任务
        if app_context.has_task:
            return json.dumps(
                {"status": "error", "message": "There is already a drawing task in progress"},
                ensure_ascii=False,
            )

        try:
            # 设置任务状态为进行中
            app_context.has_task = True
            
            # Clear previous image URLs
            app_context.image_urls.clear()

            # Send the command
            await send_to_client(app_context.websocket, command)
            logger.info(f"Sent command: {command}")

            # Poll for image URLs
            max_wait_time = 90  # Maximum wait time in seconds
            poll_interval = 1  # Poll every 0.5 seconds
            start_time = time.time()

            while time.time() - start_time < max_wait_time:
                if len(app_context.image_urls) >= 1:
                    # We have all 4 images
                    return json.dumps(
                        {"status": "success", "image_urls": app_context.image_urls},
                        ensure_ascii=False,
                    )
                else:
                    logger.info(
                        f"Waiting for image URLs... (Total: {len(app_context.image_urls)})"
                    )

                await asyncio.sleep(poll_interval)

            # Timeout occurred
            return json.dumps(
                {
                    "status": "error",
                    "message": "Timeout waiting for 4 images",
                    "received_urls": app_context.image_urls,
                },
                ensure_ascii=False,
            )
        finally:
            # 无论任务成功还是失败，都重置任务状态
            app_context.has_task = False
            app_context.image_urls.clear()

    @mcp.tool()
    def get_connection_status(ctx: Context) -> str:
        """
        Get the current WebSocket connection status.

        Returns:
            str: JSON string containing connection status.
        """

        is_connected = app_context.websocket is not None
        if is_connected:
            is_connected = app_context.websocket.state == websockets.State.OPEN
        return json.dumps(
            {"connected": is_connected, "received_images": len(app_context.image_urls)},
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
