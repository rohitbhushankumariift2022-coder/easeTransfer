const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Store connected devices and pending files
const devices = new Map();
const pendingFiles = new Map();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads with larger limits
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${uuidv4()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));
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

// File upload endpoint
app.post('/api/upload', upload.array('files', 50), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }

    const targetDeviceId = req.body.targetDevice;
    const uploaderId = req.body.uploaderId;

    const fileInfos = req.files.map(file => ({
        id: uuidv4(),
        originalName: file.originalname,
        filename: file.filename,
        size: file.size,
        mimetype: file.mimetype,
        uploadedAt: new Date().toISOString(),
        downloadUrl: `/uploads/${file.filename}`
    }));

    // Store files and notify connected devices
    fileInfos.forEach(fileInfo => {
        pendingFiles.set(fileInfo.id, fileInfo);
    });

    // Broadcast new files to all connected devices (except uploader)
    broadcastToDevices({
        type: 'new_files',
        files: fileInfos,
        fromDevice: uploaderId
    }, uploaderId);

    res.json({ success: true, files: fileInfos });
});

// Get pending files
app.get('/api/files', (req, res) => {
    const files = Array.from(pendingFiles.values());
    res.json(files);
});

// Delete file after download
app.delete('/api/files/:id', (req, res) => {
    const fileInfo = pendingFiles.get(req.params.id);
    if (fileInfo) {
        const filePath = path.join(uploadsDir, fileInfo.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        pendingFiles.delete(req.params.id);
        
        // Notify all devices
        broadcastToDevices({ type: 'file_removed', fileId: req.params.id });
    }
    res.json({ success: true });
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

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
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
                    
                    // Send existing pending files to new device
                    const existingFiles = Array.from(pendingFiles.values());
                    if (existingFiles.length > 0) {
                        ws.send(JSON.stringify({
                            type: 'existing_files',
                            files: existingFiles
                        }));
                    }
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;

                case 'file_downloaded':
                    // Notify uploader that file was downloaded
                    broadcastToDevices({
                        type: 'file_downloaded',
                        fileId: message.fileId,
                        downloadedBy: deviceId
                    });
                    break;
            }
        } catch (err) {
            console.error('Error processing message:', err);
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

// Clean up old files periodically (files older than 1 hour)
setInterval(() => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    pendingFiles.forEach((file, id) => {
        const uploadTime = new Date(file.uploadedAt).getTime();
        if (uploadTime < oneHourAgo) {
            const filePath = path.join(uploadsDir, file.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            pendingFiles.delete(id);
            broadcastToDevices({ type: 'file_removed', fileId: id });
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
