const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 100 * 1024 * 1024 }); // 100MB max

const PORT = process.env.PORT || 3000;

// Store connected devices and pending files (in memory)
const devices = new Map();
const pendingFiles = new Map();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Get local IP address
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// Generate QR code
app.get('/api/qrcode', async (req, res) => {
    const ip = getLocalIP();
    const url = `http://${ip}:${PORT}`;
    try {
        const qrDataUrl = await QRCode.toDataURL(url, {
            width: 256,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' }
        });
        res.json({ qrCode: qrDataUrl, url, ip });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});

// Get server info
app.get('/api/info', (req, res) => {
    const ip = getLocalIP();
    res.json({
        ip,
        port: PORT,
        url: `http://${ip}:${PORT}`,
        connectedDevices: devices.size
    });
});

// Get connected devices
app.get('/api/devices', (req, res) => {
    const deviceList = Array.from(devices.values()).map(d => ({
        id: d.id,
        name: d.name,
        type: d.type,
        connectedAt: d.connectedAt
    }));
    res.json(deviceList);
});

// Get pending files (metadata only)
app.get('/api/files', (req, res) => {
    const files = Array.from(pendingFiles.values()).map(f => ({
        id: f.id,
        originalName: f.originalName,
        size: f.size,
        mimetype: f.mimetype,
        uploadedAt: f.uploadedAt
    }));
    res.json(files);
});

// Broadcast message to all devices except excluded one
function broadcastToDevices(message, excludeId = null) {
    const messageStr = JSON.stringify(message);
    devices.forEach((device, id) => {
        if (id !== excludeId && device.ws.readyState === WebSocket.OPEN) {
            device.ws.send(messageStr);
        }
    });
}

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    const deviceId = uuidv4();
    
    console.log(`Device connected: ${deviceId}`);

    ws.on('message', (data, isBinary) => {
        // Handle binary data (file chunks)
        if (isBinary) {
            handleBinaryMessage(ws, deviceId, data);
            return;
        }

        try {
            const message = JSON.parse(data.toString());
            handleJsonMessage(ws, deviceId, message);
        } catch (err) {
            console.error('Failed to parse message:', err);
        }
    });

    ws.on('close', () => {
        const device = devices.get(deviceId);
        devices.delete(deviceId);
        console.log(`Device disconnected: ${deviceId}`);
        
        // Notify remaining devices
        broadcastToDevices({
            type: 'device_left',
            deviceId,
            totalDevices: devices.size
        });
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

function handleJsonMessage(ws, deviceId, message) {
    switch (message.type) {
        case 'register':
            // Register device
            devices.set(deviceId, {
                id: deviceId,
                ws,
                name: message.deviceName || 'Unknown Device',
                type: message.deviceType || 'unknown',
                connectedAt: new Date().toISOString()
            });
            
            // Send device ID back
            ws.send(JSON.stringify({
                type: 'registered',
                deviceId,
                connectedDevices: devices.size
            }));
            
            // Notify all devices of new connection
            broadcastToDevices({
                type: 'device_joined',
                device: {
                    id: deviceId,
                    name: message.deviceName,
                    type: message.deviceType
                },
                totalDevices: devices.size
            }, deviceId);
            
            // Send existing pending files metadata to new device
            const existingFiles = Array.from(pendingFiles.values()).map(f => ({
                id: f.id,
                originalName: f.originalName,
                size: f.size,
                mimetype: f.mimetype,
                uploadedAt: f.uploadedAt
            }));
            if (existingFiles.length > 0) {
                ws.send(JSON.stringify({
                    type: 'existing_files',
                    files: existingFiles
                }));
            }
            break;

        case 'file_start':
            // New file upload starting
            const fileId = uuidv4();
            pendingFiles.set(fileId, {
                id: fileId,
                originalName: message.fileName,
                size: message.fileSize,
                mimetype: message.mimeType,
                uploadedAt: new Date().toISOString(),
                chunks: [],
                receivedSize: 0,
                uploaderId: deviceId
            });
            
            // Confirm to uploader
            ws.send(JSON.stringify({
                type: 'file_start_ack',
                fileId,
                fileName: message.fileName
            }));
            break;

        case 'file_complete':
            // File upload complete
            const file = pendingFiles.get(message.fileId);
            if (file) {
                // Combine all chunks
                file.data = Buffer.concat(file.chunks);
                file.chunks = []; // Free chunk memory
                
                // Notify all other devices
                broadcastToDevices({
                    type: 'new_file',
                    file: {
                        id: file.id,
                        originalName: file.originalName,
                        size: file.size,
                        mimetype: file.mimetype,
                        uploadedAt: file.uploadedAt
                    }
                }, deviceId);
                
                // Confirm to uploader
                ws.send(JSON.stringify({
                    type: 'file_complete_ack',
                    fileId: message.fileId
                }));
                
                console.log(`File uploaded: ${file.originalName} (${formatBytes(file.size)})`);
            }
            break;

        case 'request_file':
            // Device requesting to download a file
            const requestedFile = pendingFiles.get(message.fileId);
            if (requestedFile && requestedFile.data) {
                // Send file metadata first
                ws.send(JSON.stringify({
                    type: 'file_download_start',
                    fileId: requestedFile.id,
                    fileName: requestedFile.originalName,
                    fileSize: requestedFile.size,
                    mimeType: requestedFile.mimetype
                }));
                
                // Send file data in chunks
                const chunkSize = 64 * 1024; // 64KB chunks
                const totalChunks = Math.ceil(requestedFile.data.length / chunkSize);
                
                for (let i = 0; i < totalChunks; i++) {
                    const start = i * chunkSize;
                    const end = Math.min(start + chunkSize, requestedFile.data.length);
                    const chunk = requestedFile.data.slice(start, end);
                    
                    // Send chunk with header
                    const header = Buffer.alloc(36); // fileId (36 bytes UUID)
                    header.write(requestedFile.id);
                    const packet = Buffer.concat([header, chunk]);
                    
                    ws.send(packet);
                }
                
                // Send completion
                ws.send(JSON.stringify({
                    type: 'file_download_complete',
                    fileId: requestedFile.id
                }));
            }
            break;

        case 'delete_file':
            if (pendingFiles.has(message.fileId)) {
                pendingFiles.delete(message.fileId);
                broadcastToDevices({
                    type: 'file_removed',
                    fileId: message.fileId
                });
            }
            break;

        case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
    }
}

function handleBinaryMessage(ws, deviceId, data) {
    // First 36 bytes are the file ID
    const fileId = data.slice(0, 36).toString();
    const chunk = data.slice(36);
    
    const file = pendingFiles.get(fileId);
    if (file) {
        file.chunks.push(chunk);
        file.receivedSize += chunk.length;
        
        // Send progress to uploader
        const progress = Math.round((file.receivedSize / file.size) * 100);
        ws.send(JSON.stringify({
            type: 'upload_progress',
            fileId,
            progress,
            received: file.receivedSize,
            total: file.size
        }));
    }
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Clean up old files periodically (files older than 30 minutes)
setInterval(() => {
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    pendingFiles.forEach((file, id) => {
        const uploadTime = new Date(file.uploadedAt).getTime();
        if (uploadTime < thirtyMinutesAgo) {
            pendingFiles.delete(id);
            broadcastToDevices({ type: 'file_removed', fileId: id });
            console.log(`Cleaned up old file: ${file.originalName}`);
        }
    });
}, 5 * 60 * 1000); // Check every 5 minutes

// Start server
server.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP();
    console.log('\n🚀 easeTransfer Server Started!\n');
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Network: http://${ip}:${PORT}\n`);
    console.log('   Scan the QR code on the website to connect from your phone!\n');
});
