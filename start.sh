#!/bin/bash
# HireIQ Startup Script

echo "🚀 Starting HireIQ..."
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js is required but not installed."
  echo "   Install from: https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node --version)
echo "✅ Node.js $NODE_VERSION detected"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Install backend dependencies
echo ""
echo "📦 Installing backend dependencies..."
cd "$SCRIPT_DIR/backend"
if [ ! -d "node_modules" ]; then
  npm install
fi

# Install frontend dependencies
echo ""
echo "📦 Installing frontend dependencies..."
cd "$SCRIPT_DIR/frontend"
if [ ! -d "node_modules" ]; then
  npm install
fi

# Start both servers
echo ""
echo "🔧 Starting backend API (port 3001)..."
cd "$SCRIPT_DIR/backend"
node server.js &
BACKEND_PID=$!

sleep 2

echo "🎨 Starting frontend dev server (port 5173)..."
cd "$SCRIPT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "╔════════════════════════════════════════╗"
echo "║          HireIQ is running! 🎉          ║"
echo "╠════════════════════════════════════════╣"
echo "║  App:  http://localhost:5173            ║"
echo "║  API:  http://localhost:3001            ║"
echo "╠════════════════════════════════════════╣"
echo "║  Admin:     admin@hireiq.com           ║"
echo "║  Password:  admin123                   ║"
echo "║                                        ║"
echo "║  Candidate: alice@hireiq.com           ║"
echo "║  Password:  candidate123               ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "Press Ctrl+C to stop all servers"

# Cleanup on exit
cleanup() {
  echo ""
  echo "🛑 Shutting down HireIQ..."
  kill $BACKEND_PID 2>/dev/null
  kill $FRONTEND_PID 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

wait
