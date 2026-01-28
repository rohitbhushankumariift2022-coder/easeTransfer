# easeTransfer - Fast Local File Transfer

A lightning-fast, intuitive web application for transferring files between devices on the same local network. Perfect for quickly sending images and files between iPhones, Samsung phones, and computers.

## Features

- 🚀 **Super Fast** - Uses WebSockets for real-time, low-latency transfers
- 📱 **Mobile Optimized** - Beautiful, responsive UI that works great on iPhone and Samsung
- 🔗 **QR Code Connection** - Scan QR code to instantly connect from your phone
- 📤 **Drag & Drop** - Simply drag files to upload
- 🔄 **Real-time Sync** - All connected devices see new files instantly
- 🔒 **Local Only** - Files never leave your local network
- 🗑️ **Auto Cleanup** - Files are automatically deleted after 1 hour

## Getting Started

### Prerequisites

- Node.js (v14 or higher)

### Installation

1. Navigate to the project directory:
   ```bash
   cd "A2 transfer"
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

4. Open your browser to `http://localhost:3000`

### Connecting Your Phone

1. Make sure your phone is on the same WiFi network as your computer
2. Either:
   - Scan the QR code shown on the website
   - Or manually enter the Network URL shown on the page

## How to Use

### Sending Files

1. Click the upload zone or drag files directly onto it
2. Files are instantly available for download on all connected devices
3. Multiple files can be uploaded at once

### Receiving Files

1. Files sent from other devices appear automatically in the "Available Files" section
2. Click "Save" to download a file
3. Use "Download All" to get all files at once

## Tech Stack

- **Backend**: Node.js, Express, WebSocket (ws)
- **Frontend**: Vanilla JavaScript, CSS3
- **Features**: QR Code generation, Real-time communication

## Network Configuration

The server automatically binds to all network interfaces (`0.0.0.0`) and detects your local IP address. If you have multiple network interfaces, the app will choose the first non-internal IPv4 address.

## Security Notes

- This app is designed for use on trusted local networks only
- Files are stored temporarily and auto-deleted after 1 hour
- No authentication is required - anyone on your local network can access the app

## License

MIT
