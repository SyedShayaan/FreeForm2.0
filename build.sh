#!/bin/bash

echo "🔧 Building FreeForm Whiteboard..."
echo ""

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.8 or higher."
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16 or higher."
    exit 1
fi

echo "📦 Installing backend dependencies..."
cd backend
python3 -m pip install -r requirements.txt --quiet
if [ $? -ne 0 ]; then
    echo "❌ Failed to install backend dependencies"
    exit 1
fi
cd ..

echo "📦 Installing frontend dependencies..."
cd frontend
npm install --silent
if [ $? -ne 0 ]; then
    echo "❌ Failed to install frontend dependencies"
    exit 1
fi
cd ..

echo ""
echo "✅ Build complete! Run './start.sh' to launch the whiteboard."

