const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 100 * 1024 * 1024 }); // 100MB max

const PORT = process.env.PORT || 3000;
const STATS_FILE = path.join(__dirname, 'stats.json');

// Load or initialize usage stats
function loadStats() {
    try {
        if (fs.existsSync(STATS_FILE)) {
            return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
        }
    } catch (err) {
        console.error('Error loading stats:', err);
    }
    return { totalUsers: 0, totalSessions: 0 };
}

function saveStats() {
    try {
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    } catch (err) {
        console.error('Error saving stats:', err);
    }
}

const stats = loadStats();

// Store sessions, devices, and files
const sessions = new Map(); // sessionCode -> { devices: Map, files: Map, createdAt }
const deviceToSession = new Map(); // deviceId -> sessionCode

// Generate a random 6-character session code
function generateSessionCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars like 0,O,1,I
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

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

// Generate QR code for a session
app.get('/api/qrcode', async (req, res) => {
    const ip = getLocalIP();
    const sessionCode = req.query.session || '';
    const url = sessionCode 
        ? `http://${ip}:${PORT}?session=${sessionCode}`
        : `http://${ip}:${PORT}`;
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
        url: `http://${ip}:${PORT}`
    });
});

// Get usage stats
app.get('/api/stats', (req, res) => {
    res.json({
        totalUsers: stats.totalUsers,
        totalSessions: stats.totalSessions
    });
});

// Submit feedback endpoint
app.post('/api/feedback', async (req, res) => {
    const { rating, feedback } = req.body;
    
    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Invalid rating' });
    }
    
    // Store feedback locally
    const feedbackData = {
        rating,
        feedback: feedback || '',
        timestamp: new Date().toISOString(),
        userAgent: req.headers['user-agent']
    };
    
    // Save to feedback file
    const feedbackFile = path.join(__dirname, 'feedback.json');
    let allFeedback = [];
    try {
        if (fs.existsSync(feedbackFile)) {
            allFeedback = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
        }
    } catch (err) {
        console.error('Error reading feedback file:', err);
    }
    allFeedback.push(feedbackData);
    fs.writeFileSync(feedbackFile, JSON.stringify(allFeedback, null, 2));
    
    console.log(`Feedback received: ${rating}/5 stars`);
    res.json({ success: true, message: 'Thank you for your feedback!' });
});

// Broadcast message to all devices in a session except excluded one
function broadcastToSession(sessionCode, message, excludeId = null) {
    const session = sessions.get(sessionCode);
    if (!session) return;
    
    const messageStr = JSON.stringify(message);
    session.devices.forEach((device, id) => {
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
        const sessionCode = deviceToSession.get(deviceId);
        if (sessionCode) {
            const session = sessions.get(sessionCode);
            if (session) {
                session.devices.delete(deviceId);
                console.log(`Device ${deviceId} left session ${sessionCode}`);
                
                // Notify remaining devices in session
                broadcastToSession(sessionCode, {
                    type: 'device_left',
                    deviceId,
                    totalDevices: session.devices.size
                });
                
                // Clean up empty sessions after 5 minutes
                if (session.devices.size === 0) {
                    setTimeout(() => {
                        const currentSession = sessions.get(sessionCode);
                        if (currentSession && currentSession.devices.size === 0) {
                            sessions.delete(sessionCode);
                            console.log(`Session ${sessionCode} cleaned up (empty)`);
                        }
                    }, 5 * 60 * 1000);
                }
            }
        }
        deviceToSession.delete(deviceId);
        console.log(`Device disconnected: ${deviceId}`);
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

function handleJsonMessage(ws, deviceId, message) {
    switch (message.type) {
        case 'create_session': {
            // Create a new session
            let sessionCode = generateSessionCode();
            while (sessions.has(sessionCode)) {
                sessionCode = generateSessionCode();
            }
            
            sessions.set(sessionCode, {
                devices: new Map(),
                files: new Map(),
                createdAt: new Date().toISOString()
            });
            
            // Register device in session
            const session = sessions.get(sessionCode);
            session.devices.set(deviceId, {
                id: deviceId,
                ws,
                name: message.deviceName || 'Unknown Device',
                type: message.deviceType || 'unknown',
                connectedAt: new Date().toISOString()
            });
            deviceToSession.set(deviceId, sessionCode);
            
            // Increment stats
            stats.totalUsers++;
            stats.totalSessions++;
            saveStats();
            
            ws.send(JSON.stringify({
                type: 'session_created',
                sessionCode,
                deviceId,
                connectedDevices: session.devices.size
            }));
            
            console.log(`Session ${sessionCode} created by ${message.deviceName}`);
            break;
        }

        case 'join_session': {
            // Join existing session
            const sessionCode = message.sessionCode?.toUpperCase();
            const session = sessions.get(sessionCode);
            
            if (!session) {
                ws.send(JSON.stringify({
                    type: 'session_error',
                    error: 'Session not found. Check the code and try again.'
                }));
                return;
            }
            
            // Register device in session
            session.devices.set(deviceId, {
                id: deviceId,
                ws,
                name: message.deviceName || 'Unknown Device',
                type: message.deviceType || 'unknown',
                connectedAt: new Date().toISOString()
            });
            deviceToSession.set(deviceId, sessionCode);
            
            // Increment user count
            stats.totalUsers++;
            saveStats();
            
            ws.send(JSON.stringify({
                type: 'session_joined',
                sessionCode,
                deviceId,
                connectedDevices: session.devices.size
            }));
            
            // Notify all devices of new connection
            broadcastToSession(sessionCode, {
                type: 'device_joined',
                device: {
                    id: deviceId,
                    name: message.deviceName,
                    type: message.deviceType
                },
                totalDevices: session.devices.size
            }, deviceId);
            
            // Send existing files to new device
            const existingFiles = Array.from(session.files.values()).map(f => ({
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
            
            console.log(`${message.deviceName} joined session ${sessionCode}`);
            break;
        }

        case 'file_start': {
            // New file upload starting
            const sessionCode = deviceToSession.get(deviceId);
            if (!sessionCode) return;
            
            const session = sessions.get(sessionCode);
            if (!session) return;
            
            const fileId = uuidv4();
            session.files.set(fileId, {
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
        }

        case 'file_complete': {
            // File upload complete
            const sessionCode = deviceToSession.get(deviceId);
            if (!sessionCode) return;
            
            const session = sessions.get(sessionCode);
            if (!session) return;
            
            const file = session.files.get(message.fileId);
            if (file) {
                // Combine all chunks
                file.data = Buffer.concat(file.chunks);
                file.chunks = []; // Free chunk memory
                
                // Notify all other devices in session
                broadcastToSession(sessionCode, {
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
                
                console.log(`File uploaded in session ${sessionCode}: ${file.originalName} (${formatBytes(file.size)})`);
            }
            break;
        }

        case 'request_file': {
            // Device requesting to download a file
            const sessionCode = deviceToSession.get(deviceId);
            if (!sessionCode) return;
            
            const session = sessions.get(sessionCode);
            if (!session) return;
            
            const requestedFile = session.files.get(message.fileId);
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
        }

        case 'delete_file': {
            const sessionCode = deviceToSession.get(deviceId);
            if (!sessionCode) return;
            
            const session = sessions.get(sessionCode);
            if (!session) return;
            
            if (session.files.has(message.fileId)) {
                session.files.delete(message.fileId);
                broadcastToSession(sessionCode, {
                    type: 'file_removed',
                    fileId: message.fileId
                });
            }
            break;
        }

        case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
    }
}

function handleBinaryMessage(ws, deviceId, data) {
    const sessionCode = deviceToSession.get(deviceId);
    if (!sessionCode) return;
    
    const session = sessions.get(sessionCode);
    if (!session) return;
    
    // First 36 bytes are the file ID
    const fileId = data.slice(0, 36).toString();
    const chunk = data.slice(36);
    
    const file = session.files.get(fileId);
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

// Clean up old sessions and files periodically (files older than 30 minutes)
setInterval(() => {
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    
    sessions.forEach((session, sessionCode) => {
        // Clean up old files in session
        session.files.forEach((file, fileId) => {
            const uploadTime = new Date(file.uploadedAt).getTime();
            if (uploadTime < thirtyMinutesAgo) {
                session.files.delete(fileId);
                broadcastToSession(sessionCode, { type: 'file_removed', fileId });
                console.log(`Cleaned up old file: ${file.originalName}`);
            }
        });
        
        // Clean up old empty sessions
        const sessionTime = new Date(session.createdAt).getTime();
        if (session.devices.size === 0 && sessionTime < thirtyMinutesAgo) {
            sessions.delete(sessionCode);
            console.log(`Cleaned up old session: ${sessionCode}`);
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
