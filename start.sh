#!/bin/bash

echo "🎨 Starting FreeForm Whiteboard..."
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Get local IP address
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -n 1)
else
    # Linux
    LOCAL_IP=$(hostname -I | awk '{print $1}')
fi

# Start backend server
echo "🚀 Starting backend server..."
cd backend
python3 main.py > ../backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 3

# Start frontend dev server
echo "🚀 Starting frontend dev server..."
cd frontend
npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..

# Wait for frontend to start
sleep 3

echo ""
echo "✅ FreeForm Whiteboard is running!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📍 Local Access:     http://localhost:3000"
echo "🌐 Network Access:   http://${LOCAL_IP}:3000"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 Share the Network Access URL with your team!"
echo "📝 All drawings are auto-saved and persist between restarts"
echo "🛑 Press Ctrl+C to stop the server"
echo ""

# Keep script running
wait

