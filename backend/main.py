"""
FreeForm Collaborative Whiteboard - Backend Server
"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from typing import List, Dict, Any
import json
import asyncio
from pathlib import Path
from datetime import datetime
from pydantic import BaseModel
import uuid

app = FastAPI(title="FreeForm Whiteboard")

# CORS middleware for local network access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Data models
class DrawEvent(BaseModel):
    type: str  # 'draw', 'shape', 'erase', 'clear', 'laser'
    tool: str  # 'pen', 'line', 'rectangle', 'circle', 'arrow', 'eraser', 'text', 'object-eraser', 'laser', 'lasso'
    color: str
    lineWidth: int
    lineType: str  # 'solid', 'dashed'
    points: List[Dict[str, float]]
    timestamp: float
    id: str
    clientId: str | None = None
    text: str | None = None
    fontSize: int | None = None
    imageData: str | None = None
    imageWidth: int | None = None
    imageHeight: int | None = None


class CanvasState(BaseModel):
    elements: List[DrawEvent] = []
    lastModified: str = ""


# Connection manager for WebSocket clients
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}  # clientId -> WebSocket
        self.canvas_state = CanvasState()
        self.persistence_file = Path("whiteboard_data.json")
        self.load_state()
        self.save_task = None
        
    def load_state(self):
        """Load canvas state from disk"""
        if self.persistence_file.exists():
            try:
                with open(self.persistence_file, 'r') as f:
                    data = json.load(f)
                    self.canvas_state = CanvasState(**data)
                    print(f"Loaded {len(self.canvas_state.elements)} elements from disk")
            except Exception as e:
                print(f"Error loading state: {e}")
                self.canvas_state = CanvasState()
        
    def save_state(self):
        """Save canvas state to disk"""
        try:
            self.canvas_state.lastModified = datetime.now().isoformat()
            with open(self.persistence_file, 'w') as f:
                json.dump(self.canvas_state.model_dump(), f, indent=2)
            print(f"Saved {len(self.canvas_state.elements)} elements to disk")
        except Exception as e:
            print(f"Error saving state: {e}")
    
    async def schedule_save(self):
        """Debounced auto-save - saves 2 seconds after last change"""
        if self.save_task:
            self.save_task.cancel()
        
        async def delayed_save():
            await asyncio.sleep(2)
            self.save_state()
        
        self.save_task = asyncio.create_task(delayed_save())
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        # Generate unique client ID
        client_id = str(uuid.uuid4())
        self.active_connections[client_id] = websocket
        # Send current canvas state and client ID to new client
        await websocket.send_json({
            "type": "init",
            "data": self.canvas_state.model_dump(),
            "clientId": client_id
        })
        print(f"Client {client_id} connected. Total connections: {len(self.active_connections)}")
        return client_id
    
    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
        print(f"Client {client_id} disconnected. Total connections: {len(self.active_connections)}")
    
    async def broadcast(self, message: dict, exclude_client_id: str = None):
        """Broadcast message to all connected clients except the sender"""
        disconnected = []
        for client_id, connection in self.active_connections.items():
            if client_id != exclude_client_id:
                try:
                    await connection.send_json(message)
                except:
                    disconnected.append(client_id)
        
        # Clean up disconnected clients
        for client_id in disconnected:
            if client_id in self.active_connections:
                del self.active_connections[client_id]
    
    def add_or_update_element(self, element: DrawEvent):
        """Add or update drawing element in canvas state"""
        # Check if element with this ID already exists
        existing_index = None
        for i, el in enumerate(self.canvas_state.elements):
            if el.id == element.id:
                existing_index = i
                break
        
        if existing_index is not None:
            # Update existing element
            self.canvas_state.elements[existing_index] = element
        else:
            # Add new element
            self.canvas_state.elements.append(element)
    
    def delete_element(self, element_id: str) -> bool:
        """Delete element by ID from canvas state"""
        initial_length = len(self.canvas_state.elements)
        self.canvas_state.elements = [el for el in self.canvas_state.elements if el.id != element_id]
        return len(self.canvas_state.elements) < initial_length
    
    def clear_canvas(self):
        """Clear all elements from canvas"""
        self.canvas_state.elements = []
    
    def undo_for_client(self, client_id: str) -> str | None:
        """Remove the last element created by the specified client"""
        # Find the last element with this client ID
        for i in range(len(self.canvas_state.elements) - 1, -1, -1):
            if self.canvas_state.elements[i].clientId == client_id:
                removed_element = self.canvas_state.elements.pop(i)
                return removed_element.id
        return None


manager = ConnectionManager()


@app.get("/")
async def root():
    return {"message": "FreeForm Whiteboard API", "status": "running"}


@app.get("/api/health")
async def health():
    return {
        "status": "healthy",
        "connections": len(manager.active_connections),
        "elements": len(manager.canvas_state.elements)
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    client_id = await manager.connect(websocket)
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data.get("type") == "draw":
                # Validate and store the drawing event
                try:
                    draw_event = DrawEvent(**data.get("data", {}))
                    manager.add_or_update_element(draw_event)
                    
                    # Broadcast to all other clients
                    await manager.broadcast({
                        "type": "draw",
                        "data": draw_event.model_dump()
                    }, exclude_client_id=client_id)
                    
                    # Schedule auto-save
                    await manager.schedule_save()
                    
                except Exception as e:
                    print(f"Error processing draw event: {e}")
                    import traceback
                    traceback.print_exc()
            
            elif data.get("type") == "laser":
                # Handle laser events - broadcast but don't save
                try:
                    draw_event = DrawEvent(**data.get("data", {}))
                    
                    # Broadcast laser event to all other clients (not saved)
                    await manager.broadcast({
                        "type": "laser",
                        "data": draw_event.model_dump()
                    }, exclude_client_id=client_id)
                    
                    print(f"Broadcasting laser event from client {client_id}")
                    
                except Exception as e:
                    print(f"Error processing laser event: {e}")
                    import traceback
                    traceback.print_exc()
            
            elif data.get("type") == "delete":
                element_id = data.get("elementId")
                if element_id:
                    deleted = manager.delete_element(element_id)
                    if deleted:
                        await manager.broadcast({
                            "type": "delete",
                            "elementId": element_id
                        }, exclude_client_id=client_id)
                        await manager.schedule_save()
            
            elif data.get("type") == "clear":
                manager.clear_canvas()
                await manager.broadcast({
                    "type": "clear"
                }, exclude_client_id=client_id)
                manager.save_state()
            
            elif data.get("type") == "undo":
                # Remove last element created by this client
                element_id = manager.undo_for_client(client_id)
                if element_id:
                    # Broadcast to all clients (including sender) to remove this element
                    await manager.broadcast({
                        "type": "undo",
                        "elementId": element_id
                    })
                    # Also send to the sender
                    await websocket.send_json({
                        "type": "undo",
                        "elementId": element_id
                    })
                    await manager.schedule_save()
                    
    except WebSocketDisconnect:
        manager.disconnect(client_id)
    except Exception as e:
        print(f"WebSocket error: {e}")
        manager.disconnect(client_id)


if __name__ == "__main__":
    import uvicorn
    print("\n🎨 FreeForm Whiteboard Server Starting...")
    print("📍 Server will be available at: http://localhost:8000")
    print("🌐 Access from local network at: http://<your-ip>:8000\n")
    uvicorn.run(app, host="0.0.0.0", port=8000)

