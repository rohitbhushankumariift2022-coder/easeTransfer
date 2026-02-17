require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 100 * 1024 * 1024 }); // 100MB max

const PORT = process.env.PORT || 3000;
const STATS_FILE = path.join(__dirname, 'stats.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const OTP_STORE = new Map(); // phone -> { otp, expiry, attempts }

// ========== SMS CONFIGURATION ==========
// Choose your SMS provider: 'fast2sms', 'twilio', 'msg91', 'textlocal', or 'console' (for testing)
const SMS_PROVIDER = process.env.SMS_PROVIDER || 'fast2sms';

// Fast2SMS Configuration (Get free API key from https://www.fast2sms.com/)
const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY || 'YOUR_FAST2SMS_API_KEY_HERE';

// Twilio Configuration (Get free trial from https://www.twilio.com/)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '';

// MSG91 Configuration (Get API key from https://msg91.com/)
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY || '';
const MSG91_TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID || '';

// SMS Sending Function
async function sendSMS(phone, otp) {
    const message = `Your easeTransfer OTP is: ${otp}. Valid for 5 minutes. Do not share with anyone.`;
    
    try {
        switch (SMS_PROVIDER) {
            case 'fast2sms':
                return await sendFast2SMS(phone, otp, message);
            case 'twilio':
                return await sendTwilioSMS(phone, message);
            case 'msg91':
                return await sendMSG91SMS(phone, otp);
            case 'textlocal':
                return await sendTextLocalSMS(phone, message);
            default:
                // Console logging for testing
                console.log(`[SMS] OTP for ${phone}: ${otp}`);
                return { success: true, provider: 'console' };
        }
    } catch (error) {
        console.error('SMS sending failed:', error);
        // Fallback to console
        console.log(`[SMS FALLBACK] OTP for ${phone}: ${otp}`);
        return { success: true, provider: 'console', fallback: true };
    }
}

// Fast2SMS - Free SMS for India
async function sendFast2SMS(phone, otp, message) {
    console.log('[Fast2SMS] Attempting to send OTP to:', phone);
    console.log('[Fast2SMS] API Key configured:', FAST2SMS_API_KEY ? 'Yes (length: ' + FAST2SMS_API_KEY.length + ')' : 'NO - MISSING!');
    
    if (!FAST2SMS_API_KEY || FAST2SMS_API_KEY === 'YOUR_FAST2SMS_API_KEY_HERE') {
        throw new Error('Fast2SMS API key not configured');
    }
    
    // Try DLT route first (requires template approval)
    const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
            'authorization': FAST2SMS_API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            route: 'dlt',
            sender_id: 'FSTSMS',
            message: '173257', // Fast2SMS default OTP template ID
            variables_values: otp + '|5',
            flash: 0,
            numbers: phone
        })
    });
    
    const data = await response.json();
    console.log('[Fast2SMS] Response:', JSON.stringify(data));
    
    if (data.return === true) {
        console.log(`[Fast2SMS] OTP sent successfully to ${phone}`);
        return { success: true, provider: 'fast2sms', requestId: data.request_id };
    } else {
        console.error('[Fast2SMS] Failed:', data.message);
        throw new Error(data.message || 'Fast2SMS failed');
    }
}

// Twilio SMS
async function sendTwilioSMS(phone, message) {
    const client = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    
    const result = await client.messages.create({
        body: message,
        from: TWILIO_PHONE_NUMBER,
        to: `+91${phone}`
    });
    
    console.log(`[Twilio] SMS sent to ${phone}, SID: ${result.sid}`);
    return { success: true, provider: 'twilio', sid: result.sid };
}

// MSG91 OTP SMS
async function sendMSG91SMS(phone, otp) {
    const response = await fetch(`https://api.msg91.com/api/v5/otp?template_id=${MSG91_TEMPLATE_ID}&mobile=91${phone}&otp=${otp}`, {
        method: 'POST',
        headers: {
            'authkey': MSG91_AUTH_KEY,
            'Content-Type': 'application/json'
        }
    });
    
    const data = await response.json();
    
    if (data.type === 'success') {
        console.log(`[MSG91] OTP sent to ${phone}`);
        return { success: true, provider: 'msg91', requestId: data.request_id };
    } else {
        throw new Error(data.message || 'MSG91 failed');
    }
}

// TextLocal SMS (placeholder - requires setup)
async function sendTextLocalSMS(phone, message) {
    // TextLocal integration - configure based on your account
    console.log(`[TextLocal] Would send to ${phone}: ${message}`);
    return { success: true, provider: 'textlocal' };
}

// Subscription Plans Configuration
const PLANS = {
    free: { name: 'Free', fileLimit: 5, durationDays: 1, speed: 'normal', speedMbps: 0.5, price: 0 },
    premium: { name: 'Premium', fileLimit: 100, durationDays: 3, speed: '1 Mbps', speedMbps: 1, price: 99 },
    premium_plus: { name: 'Premium Plus', fileLimit: 500, durationDays: 5, speed: '10 Mbps', speedMbps: 10, price: 199 },
    premium_pro: { name: 'Premium Pro', fileLimit: -1, durationDays: 7, speed: '50 Mbps', speedMbps: 50, price: 299 } // -1 = unlimited
};

// Load or initialize users
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
    } catch (err) {
        console.error('Error loading users:', err);
    }
    return {};
}

function saveUsers() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (err) {
        console.error('Error saving users:', err);
    }
}

const users = loadUsers();

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

// Debug endpoint to check SMS configuration (remove in production)
app.get('/api/debug/sms-config', (req, res) => {
    res.json({
        smsProvider: SMS_PROVIDER,
        fast2smsConfigured: FAST2SMS_API_KEY && FAST2SMS_API_KEY !== 'YOUR_FAST2SMS_API_KEY_HERE',
        apiKeyLength: FAST2SMS_API_KEY ? FAST2SMS_API_KEY.length : 0,
        apiKeyPreview: FAST2SMS_API_KEY ? FAST2SMS_API_KEY.substring(0, 8) + '...' : 'NOT SET',
        nodeEnv: process.env.NODE_ENV
    });
});

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

// ========== AUTHENTICATION ENDPOINTS ==========

// Generate OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send OTP (Integrated with SMS providers)
app.post('/api/auth/send-otp', async (req, res) => {
    const { phone } = req.body;
    
    if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
        return res.status(400).json({ error: 'Invalid phone number' });
    }
    
    // Check rate limiting
    const existing = OTP_STORE.get(phone);
    if (existing && existing.lastSent && Date.now() - existing.lastSent < 30000) {
        return res.status(429).json({ error: 'Please wait before requesting another OTP', retryAfter: 30 });
    }
    
    const otp = generateOTP();
    OTP_STORE.set(phone, {
        otp,
        expiry: Date.now() + 5 * 60 * 1000, // 5 minutes
        attempts: 0,
        lastSent: Date.now()
    });
    
    // Send OTP via configured SMS provider
    const smsResult = await sendSMS(phone, otp);
    
    console.log('[OTP] Send result:', JSON.stringify(smsResult));
    
    if (smsResult.success) {
        res.json({ 
            success: true, 
            message: 'OTP sent successfully',
            provider: smsResult.provider,
            // Show OTP when using console provider OR when SMS failed and fell back
            ...(smsResult.provider === 'console' && { testOtp: otp }),
            ...(smsResult.fallback && { testOtp: otp, note: 'SMS provider failed, showing OTP for testing' })
        });
    } else {
        res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
    }
});

// Verify OTP
app.post('/api/auth/verify-otp', (req, res) => {
    const { phone, otp } = req.body;
    
    if (!phone || !otp) {
        return res.status(400).json({ error: 'Phone and OTP are required' });
    }
    
    const stored = OTP_STORE.get(phone);
    
    if (!stored) {
        return res.status(400).json({ error: 'OTP not found. Please request a new one.' });
    }
    
    if (stored.attempts >= 5) {
        OTP_STORE.delete(phone);
        return res.status(400).json({ error: 'Too many attempts. Please request a new OTP.' });
    }
    
    if (Date.now() > stored.expiry) {
        OTP_STORE.delete(phone);
        return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }
    
    stored.attempts++;
    
    if (stored.otp !== otp) {
        return res.status(400).json({ error: 'Invalid OTP' });
    }
    
    // OTP verified - create or get user
    OTP_STORE.delete(phone);
    
    let user = users[phone];
    const isNewUser = !user;
    
    if (isNewUser) {
        user = {
            phone,
            plan: 'free',
            planExpiry: null,
            transferCount: 0,
            transferResetDate: new Date().toISOString().split('T')[0],
            createdAt: new Date().toISOString()
        };
        users[phone] = user;
        saveUsers();
    }
    
    // Generate session token
    const token = crypto.randomBytes(32).toString('hex');
    user.token = token;
    user.tokenExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
    saveUsers();
    
    // Calculate current plan limits
    const planInfo = getUserPlanInfo(phone);
    
    res.json({
        success: true,
        isNewUser,
        user: {
            phone: user.phone,
            plan: planInfo.plan,
            planName: planInfo.planName,
            transferCount: planInfo.transferCount,
            transferLimit: planInfo.transferLimit,
            daysLeft: planInfo.daysLeft,
            speed: planInfo.speed
        },
        token
    });
});

// Get user info
app.get('/api/auth/user', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const user = Object.values(users).find(u => u.token === token && u.tokenExpiry > Date.now());
    
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired session' });
    }
    
    const planInfo = getUserPlanInfo(user.phone);
    
    res.json({
        phone: user.phone,
        plan: planInfo.plan,
        planName: planInfo.planName,
        transferCount: planInfo.transferCount,
        transferLimit: planInfo.transferLimit,
        daysLeft: planInfo.daysLeft,
        speed: planInfo.speed
    });
});

// Helper function to get user plan info
function getUserPlanInfo(phone) {
    const user = users[phone];
    if (!user) return null;
    
    // Check if plan has expired
    let effectivePlan = user.plan || 'free';
    let daysLeft = 0;
    
    if (user.planExpiry) {
        const expiryDate = new Date(user.planExpiry);
        const now = new Date();
        
        if (expiryDate > now) {
            daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        } else {
            // Plan expired, reset to free
            effectivePlan = 'free';
            user.plan = 'free';
            user.planExpiry = null;
            saveUsers();
        }
    }
    
    // Reset transfer count daily for free users
    const today = new Date().toISOString().split('T')[0];
    if (effectivePlan === 'free' && user.transferResetDate !== today) {
        user.transferCount = 0;
        user.transferResetDate = today;
        saveUsers();
    }
    
    const planConfig = PLANS[effectivePlan];
    
    return {
        plan: effectivePlan,
        planName: planConfig.name,
        transferCount: user.transferCount || 0,
        transferLimit: planConfig.fileLimit,
        daysLeft: effectivePlan === 'free' ? 0 : daysLeft,
        speed: planConfig.speed
    };
}

// Increment transfer count
app.post('/api/transfer/increment', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const user = Object.values(users).find(u => u.token === token && u.tokenExpiry > Date.now());
    
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired session' });
    }
    
    const planInfo = getUserPlanInfo(user.phone);
    
    // Check if limit reached (skip for unlimited plans)
    if (planInfo.transferLimit !== -1 && planInfo.transferCount >= planInfo.transferLimit) {
        return res.status(403).json({ 
            error: 'Transfer limit reached',
            limitReached: true,
            currentPlan: planInfo.plan
        });
    }
    
    // Increment count
    user.transferCount = (user.transferCount || 0) + 1;
    saveUsers();
    
    const updatedPlanInfo = getUserPlanInfo(user.phone);
    
    res.json({
        success: true,
        transferCount: updatedPlanInfo.transferCount,
        transferLimit: updatedPlanInfo.transferLimit,
        limitReached: updatedPlanInfo.transferLimit !== -1 && updatedPlanInfo.transferCount >= updatedPlanInfo.transferLimit
    });
});

// ========== PAYMENT ENDPOINTS ==========

// Get available plans
app.get('/api/plans', (req, res) => {
    const planList = Object.entries(PLANS)
        .filter(([key]) => key !== 'free')
        .map(([key, plan]) => ({
            id: key,
            name: plan.name,
            price: plan.price,
            fileLimit: plan.fileLimit === -1 ? 'Unlimited' : plan.fileLimit,
            durationDays: plan.durationDays,
            speed: plan.speed,
            speedMbps: plan.speedMbps
        }));
    
    res.json(planList);
});

// Create payment order
app.post('/api/payment/create', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const { planId, paymentMethod } = req.body;
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const user = Object.values(users).find(u => u.token === token && u.tokenExpiry > Date.now());
    
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired session' });
    }
    
    const plan = PLANS[planId];
    if (!plan || planId === 'free') {
        return res.status(400).json({ error: 'Invalid plan' });
    }
    
    // Generate order ID
    const orderId = `ORD_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    // In production, integrate with payment gateway (Razorpay, PayU, etc.)
    // For now, simulate payment link generation
    const paymentLink = `https://pay.easetransfer.com/${orderId}`;
    
    // Store pending order
    user.pendingOrder = {
        orderId,
        planId,
        amount: plan.price,
        paymentMethod,
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    saveUsers();
    
    res.json({
        success: true,
        orderId,
        amount: plan.price,
        currency: 'INR',
        paymentLink,
        // In production, return gateway-specific data
        upiId: 'easetransfer@upi', // Demo UPI ID
        qrCodeData: `upi://pay?pa=easetransfer@upi&pn=easeTransfer&am=${plan.price}&cu=INR&tn=Plan-${planId}`
    });
});

// Verify/Complete payment (In production, this would be a webhook from payment gateway)
app.post('/api/payment/verify', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const { orderId, paymentId } = req.body;
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const user = Object.values(users).find(u => u.token === token && u.tokenExpiry > Date.now());
    
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired session' });
    }
    
    if (!user.pendingOrder || user.pendingOrder.orderId !== orderId) {
        return res.status(400).json({ error: 'Order not found' });
    }
    
    // In production, verify with payment gateway
    // For demo, simulate successful payment
    const order = user.pendingOrder;
    const plan = PLANS[order.planId];
    
    // Activate plan
    const now = new Date();
    const expiry = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
    
    user.plan = order.planId;
    user.planExpiry = expiry.toISOString();
    user.transferCount = 0; // Reset counter for new plan
    user.transferResetDate = now.toISOString().split('T')[0];
    
    // Mark order as completed
    user.pendingOrder.status = 'completed';
    user.pendingOrder.paymentId = paymentId || `PAY_${Date.now()}`;
    user.pendingOrder.completedAt = now.toISOString();
    
    // Archive order
    if (!user.orderHistory) user.orderHistory = [];
    user.orderHistory.push(user.pendingOrder);
    delete user.pendingOrder;
    
    saveUsers();
    
    const planInfo = getUserPlanInfo(user.phone);
    
    res.json({
        success: true,
        message: 'Payment successful! Plan activated.',
        plan: planInfo
    });
});

// Simulate payment for demo (remove in production)
app.post('/api/payment/simulate', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const { orderId } = req.body;
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const user = Object.values(users).find(u => u.token === token && u.tokenExpiry > Date.now());
    
    if (!user || !user.pendingOrder || user.pendingOrder.orderId !== orderId) {
        return res.status(400).json({ error: 'Invalid order' });
    }
    
    // Simulate successful payment
    const order = user.pendingOrder;
    const plan = PLANS[order.planId];
    
    const now = new Date();
    const expiry = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
    
    user.plan = order.planId;
    user.planExpiry = expiry.toISOString();
    user.transferCount = 0;
    user.transferResetDate = now.toISOString().split('T')[0];
    
    user.pendingOrder.status = 'completed';
    user.pendingOrder.paymentId = `SIM_${Date.now()}`;
    user.pendingOrder.completedAt = now.toISOString();
    
    if (!user.orderHistory) user.orderHistory = [];
    user.orderHistory.push(user.pendingOrder);
    delete user.pendingOrder;
    
    saveUsers();
    
    const planInfo = getUserPlanInfo(user.phone);
    
    res.json({
        success: true,
        message: 'Payment simulated successfully!',
        plan: planInfo
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
