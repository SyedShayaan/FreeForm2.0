# FreeForm Whiteboard

A real-time collaborative whiteboard application for teams. Draw, brainstorm, and collaborate with multiple users on an infinite canvas.

## Features

- 🎨 **Infinite Canvas** - Unlimited drawing space, pan with Shift+drag or middle mouse
- 🔍 **Zoom Controls** - Mouse wheel zoom (desktop) and pinch-to-zoom (touch), 10%-500% zoom range
- 📐 **Background Styles** - Choose from blank, grid, dots, or lined paper backgrounds
- 🖊️ **Drawing Tools** - Pen, line, rectangle, circle, arrow, text, laser, and eraser
- 📱 **Touch Support** - Full iPad/tablet support with Apple Pencil and stylus
- 🗑️ **Object Eraser** - Delete individual drawings by clicking on them
- 📝 **Text Tool** - Add text annotations anywhere on the canvas (click to edit existing text)
- ✨ **Laser Pointer** - Temporary drawing that fades out (perfect for presentations)
- 🎨 **Customization** - Choose colors, line widths, and line types (solid/dashed)
- 👥 **Real-time Collaboration** - Multiple users can draw simultaneously
- 💾 **Auto-save** - All drawings automatically persist between server restarts
- 🌐 **Local Network** - No authentication required, perfect for team brainstorming
- ⚡ **Fast & Responsive** - WebSocket-based real-time updates

## Requirements

- Python 3.8 or higher
- Node.js 16 or higher
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Works on desktop, iPad, and tablets with touch/stylus support

## Quick Start

### 1. Build (First Time Only)

```bash
chmod +x build.sh
./build.sh
```

### 2. Start the Server

```bash
chmod +x start.sh
./start.sh
```

The script will show you:
- **Local URL**: Access on your computer
- **Network URL**: Share with teammates on the same network

### 3. Open in Browser

Open the displayed URL in your browser and start drawing!

## Usage

### Drawing Tools

- **Pen** ✏️ - Freehand drawing
- **Line** / - Draw straight lines
- **Rectangle** ▭ - Draw rectangles
- **Circle** ○ - Draw circles
- **Arrow** → - Draw arrows
- **Text** T - Add text (click to place, type, press Enter to confirm, click existing text to edit)
- **Laser** ✨ - Temporary pointer that fades out (doesn't save, perfect for presentations)
- **Eraser** 🧹 - Pixel eraser (erases by drawing over)
- **Delete** 🗑️ - Object eraser (click on any drawing to delete it)

### Controls

**Desktop:**
- **Left Click + Drag** - Draw with selected tool
- **Left Click** (Text tool) - Place text, type, and press Enter to confirm
- **Left Click** (Delete tool) - Click on any drawing to delete it
- **Shift + Left Click + Drag** - Pan the canvas
- **Middle Mouse + Drag** - Pan the canvas
- **Mouse Wheel** - Zoom in/out towards cursor position
- **Undo** - Remove last drawing
- **Clear All** - Clear entire whiteboard (affects all users)
- **ESC** - Cancel text input

**iPad/Tablet:**
- **Touch/Pencil + Drag** - Draw with selected tool
- **Single Tap** (Text tool) - Place text
- **Single Tap** (Delete tool) - Delete drawing
- **Two-finger Drag** - Pan the canvas
- **Pinch** - Zoom in/out towards pinch center

### Customization

- Choose from 12 colors
- Select line width (2px - 16px, also affects text size)
- Toggle between solid and dashed lines
- Text size scales with line width (6x multiplier)
- Zoom level: 10% to 500%

### Background Styles

Choose from 4 different background styles in the toolbar:
- **Blank** ⬜ - Clean white background
- **Grid** ⊞ - Square grid pattern (50px spacing)
- **Dots** ⋮⋮ - Dot grid pattern (50px spacing)
- **Lines** ☰ - Horizontal lines like notebook paper (50px spacing)

Background styles are client-side only - each user can choose their preferred background independently.

### Zoom Controls

Located at the bottom center of the screen:
- **− button** - Zoom out
- **+ button** - Zoom in
- **⊙ button** - Reset to 100%
- **Slider** - Adjust zoom precisely
- **Percentage display** - Shows current zoom level

Alternative zoom methods:
- Desktop: Mouse wheel (zooms towards cursor)
- Touch: Pinch gesture (zooms towards pinch center)

## Technical Details

### Architecture

- **Backend**: Python FastAPI with WebSockets
- **Frontend**: React + TypeScript + HTML5 Canvas
- **Persistence**: JSON file storage with auto-save
- **Communication**: Real-time WebSocket updates

### Ports

- Backend API: `8000`
- Frontend Dev Server: `3000`

### Data Storage

All whiteboard data is saved to `backend/whiteboard_data.json` and automatically loads on server restart.

## Troubleshooting

### Server won't start

Make sure ports 3000 and 8000 are not in use:

```bash
# Check ports
lsof -i :3000
lsof -i :8000

# Kill processes if needed
kill -9 <PID>
```

### Connection issues

- Ensure your firewall allows connections on ports 3000 and 8000
- Verify all devices are on the same network
- Check that the backend server is running (look for backend.log)

### Drawings not persisting

- Check write permissions in the backend directory
- Look at backend.log for error messages

## Logs

- Backend logs: `backend.log`
- Frontend logs: `frontend.log`

## Stopping the Server

Press `Ctrl+C` in the terminal where start.sh is running.

## Development

### Manual Start (Development)

**Backend:**
```bash
cd backend
python3 main.py
```

**Frontend:**
```bash
cd frontend
npm run dev
```

### Build for Production

```bash
cd frontend
npm run build
```

## License

Free to use for internal team collaboration.

---

Made for seamless team brainstorming 🚀

