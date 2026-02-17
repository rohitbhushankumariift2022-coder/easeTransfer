// easeTransfer - Fast Local File Transfer

// Subscription System (Local storage based - no authentication required)
class SubscriptionSystem {
    constructor() {
        this.currentPlan = 'free';
        this.transferCount = 0;
        this.transferLimit = 5;
        this.planExpiry = null;
        this.init();
    }

    init() {
        this.setupElements();
        this.setupEventListeners();
        this.loadFromLocalStorage();
        this.updateUIFromLocal();
    }

    loadFromLocalStorage() {
        try {
            const stored = localStorage.getItem('easeTransferUser');
            if (stored) {
                const data = JSON.parse(stored);
                this.currentPlan = data.plan || 'free';
                this.transferCount = data.transferCount || 0;
                this.planExpiry = data.planExpiry || null;
                
                // Check if plan has expired
                if (this.planExpiry && new Date(this.planExpiry) < new Date()) {
                    this.currentPlan = 'free';
                    this.planExpiry = null;
                }
                
                // Reset daily transfer count for free users
                const today = new Date().toISOString().split('T')[0];
                if (this.currentPlan === 'free' && data.transferResetDate !== today) {
                    this.transferCount = 0;
                    this.saveToLocalStorage(today);
                }
            }
            
            // Set transfer limit based on plan
            const planLimits = {
                free: 5,
                premium: 100,
                premium_plus: 500,
                premium_pro: -1 // unlimited
            };
            this.transferLimit = planLimits[this.currentPlan] || 5;
        } catch (err) {
            console.error('Error loading user data:', err);
        }
    }

    saveToLocalStorage(resetDate = null) {
        try {
            const data = {
                plan: this.currentPlan,
                transferCount: this.transferCount,
                planExpiry: this.planExpiry,
                transferResetDate: resetDate || new Date().toISOString().split('T')[0]
            };
            localStorage.setItem('easeTransferUser', JSON.stringify(data));
        } catch (err) {
            console.error('Error saving user data:', err);
        }
    }

    updateUIFromLocal() {
        let daysLeft = 0;
        if (this.planExpiry) {
            const expiry = new Date(this.planExpiry);
            const now = new Date();
            daysLeft = Math.max(0, Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)));
        }
        
        this.updateUI({
            plan: this.currentPlan,
            planName: this.getPlanName(this.currentPlan),
            transferCount: this.transferCount,
            transferLimit: this.transferLimit,
            daysLeft: daysLeft
        });
    }

    setupElements() {
        this.elements = {
            transferCounter: document.getElementById('transferCounter'),
            transferCount: document.getElementById('transferCount'),
            transferLimit: document.getElementById('transferLimit'),
            planBadge: document.getElementById('planBadge'),
            daysLeft: document.getElementById('daysLeft'),
            premiumModal: document.getElementById('premiumModal'),
            premiumClose: document.getElementById('premiumClose'),
            premiumReason: document.getElementById('premiumReason'),
            upgradeBtn: document.getElementById('upgradeBtn')
        };
    }

    setupEventListeners() {
        this.elements.premiumClose?.addEventListener('click', () => this.hidePremiumModal());
        document.querySelector('.premium-backdrop')?.addEventListener('click', () => this.hidePremiumModal());
        this.elements.upgradeBtn?.addEventListener('click', () => this.showPremiumModal('Upgrade to unlock more transfers'));
        
        // Counter tooltip
        this.elements.transferCounter?.addEventListener('click', () => {
            if (this.currentPlan === 'free') {
                this.showPremiumModal('Upgrade to unlock more transfers');
            }
        });
    }

    updateUI(user) {
        if (!user) return;

        this.currentPlan = user.plan;
        this.transferCount = user.transferCount;
        this.transferLimit = user.transferLimit;

        // Update counter
        if (this.elements.transferCount) {
            this.elements.transferCount.textContent = this.transferCount;
        }
        if (this.elements.transferLimit) {
            this.elements.transferLimit.textContent = this.transferLimit === -1 ? '∞' : this.transferLimit;
        }

        // Update plan badge
        if (this.elements.planBadge) {
            this.elements.planBadge.className = `plan-badge-small ${user.plan}`;
            this.elements.planBadge.textContent = user.planName;
        }

        // Update days left
        if (this.elements.daysLeft) {
            if (user.daysLeft > 0) {
                this.elements.daysLeft.textContent = `${user.daysLeft} days left`;
            } else if (user.plan === 'free') {
                this.elements.daysLeft.textContent = 'Upgrade for more';
            } else {
                this.elements.daysLeft.textContent = 'Plan active';
            }
        }

        // Show/hide upgrade button
        if (this.elements.upgradeBtn) {
            this.elements.upgradeBtn.style.display = user.plan === 'free' ? 'flex' : 'none';
        }

        // Update counter color based on usage
        if (this.elements.transferCounter && this.transferLimit !== -1) {
            const usage = this.transferCount / this.transferLimit;
            if (usage >= 1) {
                this.elements.transferCounter.classList.add('limit-reached');
            } else if (usage >= 0.8) {
                this.elements.transferCounter.classList.add('limit-warning');
            } else {
                this.elements.transferCounter.classList.remove('limit-reached', 'limit-warning');
            }
        }
    }

    async checkAndIncrementTransfer() {
        // Check if limit reached (skip for unlimited plans)
        if (this.transferLimit !== -1 && this.transferCount >= this.transferLimit) {
            this.showPremiumModal('You\'ve reached your transfer limit!');
            return { allowed: false, limitReached: true };
        }

        // Increment count locally
        this.transferCount++;
        this.saveToLocalStorage();
        this.updateUIFromLocal();

        // Check if limit now reached
        if (this.transferLimit !== -1 && this.transferCount >= this.transferLimit) {
            return { allowed: true, limitReached: true };
        }

        return { allowed: true };
    }

    // Activate a premium plan (called after successful payment)
    activatePlan(planId, durationDays) {
        const planLimits = {
            premium: 100,
            premium_plus: 500,
            premium_pro: -1
        };
        
        this.currentPlan = planId;
        this.transferLimit = planLimits[planId] || 5;
        this.transferCount = 0;
        
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + durationDays);
        this.planExpiry = expiry.toISOString();
        
        this.saveToLocalStorage();
        this.updateUIFromLocal();
    }

    getPlanName(plan) {
        const names = {
            free: 'Free',
            premium: 'Premium',
            premium_plus: 'Premium Plus',
            premium_pro: 'Premium Pro'
        };
        return names[plan] || 'Free';
    }

    showPremiumModal(reason = 'Upgrade to unlock more features') {
        if (this.elements.premiumReason) {
            this.elements.premiumReason.textContent = reason;
        }
        this.elements.premiumModal?.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    hidePremiumModal() {
        this.elements.premiumModal?.classList.remove('show');
        document.body.style.overflow = '';
    }

    isLimitReached() {
        return this.transferLimit !== -1 && this.transferCount >= this.transferLimit;
    }
}

// Payment System
class PaymentSystem {
    constructor() {
        this.selectedPlan = null;
        this.orderId = null;
        this.init();
    }

    init() {
        this.setupElements();
        this.setupEventListeners();
    }

    setupElements() {
        this.elements = {
            paymentModal: document.getElementById('paymentModal'),
            paymentClose: document.getElementById('paymentClose'),
            paymentAmount: document.getElementById('paymentAmount'),
            paymentPlanName: document.getElementById('paymentPlanName'),
            paymentMethods: document.querySelector('.payment-methods'),
            upiPayment: document.getElementById('upiPayment'),
            cardPayment: document.getElementById('cardPayment'),
            linkPayment: document.getElementById('linkPayment'),
            paymentProcessing: document.getElementById('paymentProcessing'),
            paymentSuccess: document.getElementById('paymentSuccess'),
            successPlanName: document.getElementById('successPlanName'),
            upiIdInput: document.getElementById('upiIdInput'),
            payUpiBtn: document.getElementById('payUpiBtn'),
            payCardBtn: document.getElementById('payCardBtn'),
            paymentLinkUrl: document.getElementById('paymentLinkUrl'),
            copyPaymentLink: document.getElementById('copyPaymentLink'),
            cardNumber: document.getElementById('cardNumber'),
            cardExpiry: document.getElementById('cardExpiry'),
            cardCvv: document.getElementById('cardCvv'),
            cardName: document.getElementById('cardName')
        };
    }

    setupEventListeners() {
        this.elements.paymentClose?.addEventListener('click', () => this.closePayment());
        document.querySelector('.payment-backdrop')?.addEventListener('click', () => this.closePayment());

        // Payment method selection
        document.querySelectorAll('.payment-method').forEach(method => {
            method.addEventListener('click', () => {
                const methodType = method.dataset.method;
                this.showPaymentMethod(methodType);
            });
        });

        // UPI payment
        this.elements.payUpiBtn?.addEventListener('click', () => this.processUpiPayment());

        // Card payment
        this.elements.payCardBtn?.addEventListener('click', () => this.processCardPayment());

        // Copy payment link
        this.elements.copyPaymentLink?.addEventListener('click', () => this.copyPaymentLinkToClipboard());

        // Card number formatting
        this.elements.cardNumber?.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            value = value.replace(/(\d{4})/g, '$1 ').trim();
            e.target.value = value.slice(0, 19);
        });

        // Expiry formatting
        this.elements.cardExpiry?.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length >= 2) {
                value = value.slice(0, 2) + '/' + value.slice(2, 4);
            }
            e.target.value = value;
        });

        // CVV
        this.elements.cardCvv?.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 3);
        });
    }

    async selectPlan(planId) {
        this.selectedPlan = planId;
        
        const plans = {
            premium: { name: 'Premium', price: 99 },
            premium_plus: { name: 'Premium Plus', price: 199 },
            premium_pro: { name: 'Premium Pro', price: 299 }
        };

        const plan = plans[planId];
        if (!plan) return;

        // Update modal
        if (this.elements.paymentAmount) {
            this.elements.paymentAmount.textContent = `₹${plan.price}`;
        }
        if (this.elements.paymentPlanName) {
            this.elements.paymentPlanName.textContent = plan.name;
        }

        // Generate a demo payment link
        if (this.elements.paymentLinkUrl) {
            this.elements.paymentLinkUrl.value = `https://pay.easetransfer.com/demo/${planId}`;
        }

        // Close premium modal, open payment modal
        window.subscriptionSystem?.hidePremiumModal();
        this.showPaymentModal();
    }

    showPaymentModal() {
        this.elements.paymentModal?.classList.add('show');
        this.showMethods();
        document.body.style.overflow = 'hidden';
    }

    closePayment() {
        this.elements.paymentModal?.classList.remove('show');
        document.body.style.overflow = '';
        this.showMethods();
    }

    showMethods() {
        this.elements.paymentMethods?.classList.remove('hidden');
        this.elements.upiPayment?.classList.add('hidden');
        this.elements.cardPayment?.classList.add('hidden');
        this.elements.linkPayment?.classList.add('hidden');
        this.elements.paymentProcessing?.classList.add('hidden');
        this.elements.paymentSuccess?.classList.add('hidden');
    }

    showPaymentMethod(method) {
        this.elements.paymentMethods?.classList.add('hidden');
        this.elements.upiPayment?.classList.add('hidden');
        this.elements.cardPayment?.classList.add('hidden');
        this.elements.linkPayment?.classList.add('hidden');

        switch (method) {
            case 'upi':
                this.elements.upiPayment?.classList.remove('hidden');
                break;
            case 'card':
                this.elements.cardPayment?.classList.remove('hidden');
                break;
            case 'link':
                this.elements.linkPayment?.classList.remove('hidden');
                break;
        }
    }

    async processUpiPayment() {
        const upiId = this.elements.upiIdInput?.value.trim();
        
        if (!upiId || !upiId.includes('@')) {
            window.easeTransfer?.showToast('Please enter a valid UPI ID', 'error');
            return;
        }

        await this.processPayment();
    }

    async processCardPayment() {
        const cardNumber = this.elements.cardNumber?.value.replace(/\s/g, '');
        const expiry = this.elements.cardExpiry?.value;
        const cvv = this.elements.cardCvv?.value;
        const name = this.elements.cardName?.value.trim();

        if (!cardNumber || cardNumber.length < 16) {
            window.easeTransfer?.showToast('Please enter a valid card number', 'error');
            return;
        }
        if (!expiry || expiry.length < 5) {
            window.easeTransfer?.showToast('Please enter card expiry', 'error');
            return;
        }
        if (!cvv || cvv.length < 3) {
            window.easeTransfer?.showToast('Please enter CVV', 'error');
            return;
        }
        if (!name) {
            window.easeTransfer?.showToast('Please enter cardholder name', 'error');
            return;
        }

        await this.processPayment();
    }

    async processPayment() {
        // Show processing
        this.elements.upiPayment?.classList.add('hidden');
        this.elements.cardPayment?.classList.add('hidden');
        this.elements.linkPayment?.classList.add('hidden');
        this.elements.paymentProcessing?.classList.remove('hidden');

        if (!this.selectedPlan) {
            window.easeTransfer?.showToast('Payment error. Please try again.', 'error');
            this.showMethods();
            return;
        }

        try {
            // Simulate payment processing (In production, use actual payment gateway)
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Get plan duration
            const planDurations = {
                premium: 3,
                premium_plus: 5,
                premium_pro: 7
            };
            
            const duration = planDurations[this.selectedPlan] || 3;
            
            // Activate plan locally
            window.subscriptionSystem?.activatePlan(this.selectedPlan, duration);
            
            this.showSuccess({
                plan: this.selectedPlan,
                planName: window.subscriptionSystem?.getPlanName(this.selectedPlan) || 'Premium'
            });
            
            window.easeTransfer?.showToast('Payment successful! Plan activated.', 'success');
        } catch (err) {
            console.error('Payment error:', err);
            window.easeTransfer?.showToast('Payment failed. Please try again.', 'error');
            this.showMethods();
        }
    }

    showSuccess(plan) {
        this.elements.paymentProcessing?.classList.add('hidden');
        this.elements.paymentSuccess?.classList.remove('hidden');
        
        if (this.elements.successPlanName) {
            this.elements.successPlanName.textContent = plan.planName;
        }

        // Update subscription UI
        window.subscriptionSystem?.updateUI(plan);
    }

    openPaymentLink() {
        const link = this.elements.paymentLinkUrl?.value;
        if (link) {
            window.open(link, '_blank');
        }
    }

    copyPaymentLinkToClipboard() {
        const link = this.elements.paymentLinkUrl?.value;
        if (link) {
            navigator.clipboard.writeText(link).then(() => {
                window.easeTransfer?.showToast('Payment link copied!', 'success');
            });
        }
    }
}

class EaseTransfer {
    constructor() {
        this.ws = null;
        this.deviceId = null;
        this.sessionCode = null;
        this.files = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.uploadQueue = [];
        this.downloading = new Map();
        
        this.init();
    }

    init() {
        this.setupElements();
        this.setupEventListeners();
        this.setupTheme();
        this.detectDeviceType();
        this.checkUrlForSession();
        this.connectWebSocket();
        this.loadUsageStats();
    }

    async loadUsageStats() {
        try {
            const response = await fetch('/api/stats');
            const data = await response.json();
            const userCountEl = document.getElementById('userCount');
            if (userCountEl) {
                userCountEl.textContent = data.totalUsers.toLocaleString();
            }
        } catch (err) {
            console.error('Failed to load usage stats:', err);
        }
    }

    checkUrlForSession() {
        // Check if there's a session code in the URL
        const urlParams = new URLSearchParams(window.location.search);
        const sessionFromUrl = urlParams.get('session');
        if (sessionFromUrl) {
            this.pendingSessionCode = sessionFromUrl.toUpperCase();
        }
    }

    setupElements() {
        this.elements = {
            sessionScreen: document.getElementById('sessionScreen'),
            mainContent: document.getElementById('mainContent'),
            createSession: document.getElementById('createSession'),
            joinSession: document.getElementById('joinSession'),
            sessionCodeInput: document.getElementById('sessionCodeInput'),
            sessionCode: document.getElementById('sessionCode'),
            copyCode: document.getElementById('copyCode'),
            connectionStatus: document.getElementById('connectionStatus'),
            statusDot: document.querySelector('.status-dot'),
            statusText: document.querySelector('.status-text'),
            deviceCount: document.getElementById('deviceCount'),
            toggleQR: document.getElementById('toggleQR'),
            qrContainer: document.getElementById('qrContainer'),
            qrCode: document.getElementById('qrCode'),
            uploadZone: document.getElementById('uploadZone'),
            fileInput: document.getElementById('fileInput'),
            uploadProgress: document.getElementById('uploadProgress'),
            progressFill: document.getElementById('progressFill'),
            progressPercent: document.getElementById('progressPercent'),
            filesList: document.getElementById('filesList'),
            fileCount: document.getElementById('fileCount'),
            downloadAll: document.getElementById('downloadAll'),
            toastContainer: document.getElementById('toastContainer'),
            themeToggle: document.getElementById('themeToggle')
        };
    }

    setupTheme() {
        const savedTheme = localStorage.getItem('theme');
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const theme = savedTheme || (systemDark ? 'dark' : 'light');
        
        document.documentElement.setAttribute('data-theme', theme);
        this.updateThemeColor(theme);

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem('theme')) {
                const newTheme = e.matches ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', newTheme);
                this.updateThemeColor(newTheme);
            }
        });
    }

    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const newTheme = current === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        this.updateThemeColor(newTheme);
    }

    updateThemeColor(theme) {
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
            metaTheme.setAttribute('content', theme === 'dark' ? '#0a0a0a' : '#ffffff');
        }
    }

    setupEventListeners() {
        // Theme Toggle
        this.elements.themeToggle.addEventListener('click', () => this.toggleTheme());

        // Session buttons
        this.elements.createSession.addEventListener('click', () => this.createSession());
        this.elements.joinSession.addEventListener('click', () => this.joinSession());
        this.elements.sessionCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinSession();
        });
        this.elements.sessionCodeInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        });

        // Copy session code
        this.elements.copyCode.addEventListener('click', () => this.copySessionCode());

        // QR Toggle
        this.elements.toggleQR.addEventListener('click', () => {
            this.elements.qrContainer.classList.toggle('show');
            if (this.elements.qrContainer.classList.contains('show')) {
                this.loadQRCode();
            }
        });

        // File Upload
        this.elements.uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.elements.uploadZone.classList.add('dragover');
        });

        this.elements.uploadZone.addEventListener('dragleave', () => {
            this.elements.uploadZone.classList.remove('dragover');
        });

        this.elements.uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.elements.uploadZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.uploadFiles(files);
            }
        });

        this.elements.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.uploadFiles(e.target.files);
            }
        });

        // Download All
        this.elements.downloadAll.addEventListener('click', () => this.downloadAllFiles());

        // Viewer Modal
        document.getElementById('viewerClose').addEventListener('click', () => this.closeViewer());
        document.getElementById('viewerModal').querySelector('.viewer-backdrop').addEventListener('click', () => this.closeViewer());
        document.getElementById('viewerDownload').addEventListener('click', () => {
            if (this.currentViewFileId) {
                this.downloadFile(this.currentViewFileId);
            }
        });

        // Escape key to close viewer
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeViewer();
            }
        });

        // Visibility change - reconnect when page becomes visible
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
                this.connectWebSocket();
            }
        });
    }

    detectDeviceType() {
        const ua = navigator.userAgent.toLowerCase();
        if (/iphone|ipad|ipod/.test(ua)) {
            this.deviceType = 'iphone';
            this.deviceName = 'iPhone';
        } else if (/android/.test(ua)) {
            this.deviceType = 'android';
            this.deviceName = 'Android Device';
            if (/samsung/.test(ua)) {
                this.deviceName = 'Samsung';
            }
        } else if (/macintosh|mac os x/.test(ua)) {
            this.deviceType = 'mac';
            this.deviceName = 'Mac';
        } else if (/windows/.test(ua)) {
            this.deviceType = 'windows';
            this.deviceName = 'Windows PC';
        } else {
            this.deviceType = 'unknown';
            this.deviceName = 'Device';
        }
    }

    createSession() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'create_session',
                deviceName: this.deviceName,
                deviceType: this.deviceType
            }));
        }
    }

    joinSession() {
        const code = this.elements.sessionCodeInput.value.trim().toUpperCase();
        if (code.length !== 6) {
            this.showToast('Please enter a 6-character code', 'error');
            return;
        }
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'join_session',
                sessionCode: code,
                deviceName: this.deviceName,
                deviceType: this.deviceType
            }));
        }
    }

    enterSession(sessionCode) {
        this.sessionCode = sessionCode;
        this.elements.sessionCode.textContent = sessionCode;
        this.elements.sessionScreen.style.display = 'none';
        this.elements.mainContent.style.display = 'flex';
        
        // Update URL without reloading
        const newUrl = `${window.location.origin}${window.location.pathname}?session=${sessionCode}`;
        window.history.replaceState({}, '', newUrl);
    }

    copySessionCode() {
        if (this.sessionCode) {
            navigator.clipboard.writeText(this.sessionCode).then(() => {
                this.showToast('Session code copied!', 'success');
            }).catch(() => {
                this.showToast('Failed to copy code', 'error');
            });
        }
    }

    async loadQRCode() {
        try {
            const response = await fetch(`/api/qrcode?session=${this.sessionCode || ''}`);
            const data = await response.json();
            this.elements.qrCode.src = data.qrCode;
        } catch (err) {
            console.error('Failed to load QR code:', err);
        }
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;

        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.reconnectAttempts = 0;
            this.updateConnectionStatus('connected');
            
            // If we have a pending session code from URL, auto-join
            if (this.pendingSessionCode) {
                this.ws.send(JSON.stringify({
                    type: 'join_session',
                    sessionCode: this.pendingSessionCode,
                    deviceName: this.deviceName,
                    deviceType: this.deviceType
                }));
                this.pendingSessionCode = null;
            }
        };

        this.ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                this.handleBinaryMessage(event.data);
                return;
            }
            
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            } catch (err) {
                console.error('Failed to parse message:', err);
            }
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.updateConnectionStatus('disconnected');
            
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                setTimeout(() => this.connectWebSocket(), 2000 * this.reconnectAttempts);
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    handleBinaryMessage(data) {
        // First 36 bytes are fileId
        const fileIdBytes = new Uint8Array(data.slice(0, 36));
        const fileId = new TextDecoder().decode(fileIdBytes);
        const chunk = data.slice(36);
        
        const download = this.downloading.get(fileId);
        if (download) {
            download.chunks.push(chunk);
            download.received += chunk.byteLength;
            
            // Update progress
            const progress = Math.round((download.received / download.size) * 100);
            this.showToast(`Downloading: ${progress}%`, 'info');
        }
    }

    handleMessage(message) {
        switch (message.type) {
            case 'session_created':
                this.deviceId = message.deviceId;
                this.enterSession(message.sessionCode);
                this.updateDeviceCount(message.connectedDevices);
                this.showToast('Session created! Share the code to connect devices.', 'success');
                break;

            case 'session_joined':
                this.deviceId = message.deviceId;
                this.enterSession(message.sessionCode);
                this.updateDeviceCount(message.connectedDevices);
                this.showToast('Joined session successfully!', 'success');
                break;

            case 'session_error':
                this.showToast(message.error, 'error');
                break;

            case 'device_joined':
                this.updateDeviceCount(message.totalDevices);
                this.showToast(`${message.device.name} connected`, 'info');
                break;

            case 'device_left':
                this.updateDeviceCount(message.totalDevices);
                break;

            case 'new_file':
                this.files.set(message.file.id, message.file);
                this.renderFiles();
                this.showToast(`New file: ${message.file.originalName}`, 'success');
                break;

            case 'existing_files':
                message.files.forEach(f => this.files.set(f.id, f));
                this.renderFiles();
                break;

            case 'file_removed':
                this.files.delete(message.fileId);
                this.renderFiles();
                break;

            case 'file_start_ack':
                // Server confirmed file upload start, begin sending chunks
                this.sendFileChunks(message.fileId, message.fileName);
                break;

            case 'upload_progress':
                this.updateProgress(message.progress);
                break;

            case 'file_complete_ack':
                this.hideUploadProgress();
                this.showToast('File uploaded!', 'success');
                this.processUploadQueue();
                break;

            case 'file_download_start':
                this.downloading.set(message.fileId, {
                    fileName: message.fileName,
                    size: message.fileSize,
                    mimeType: message.mimeType,
                    chunks: [],
                    received: 0,
                    forPreview: this.viewMode
                });
                break;

            case 'file_download_complete':
                this.completeDownload(message.fileId);
                break;

            case 'pong':
                break;
        }
    }

    updateConnectionStatus(status) {
        const { statusDot, statusText } = this.elements;
        
        statusDot.classList.remove('connected', 'disconnected');
        
        switch (status) {
            case 'connected':
                statusDot.classList.add('connected');
                statusText.textContent = 'Connected';
                break;
            case 'disconnected':
                statusDot.classList.add('disconnected');
                statusText.textContent = 'Disconnected';
                break;
            default:
                statusText.textContent = 'Connecting...';
        }
    }

    updateDeviceCount(count) {
        this.elements.deviceCount.textContent = count;
    }

    async uploadFiles(fileList) {
        const files = Array.from(fileList);
        if (files.length === 0) return;

        // Check transfer limit before uploading
        const result = await window.subscriptionSystem?.checkAndIncrementTransfer();
        if (result && !result.allowed) {
            if (result.limitReached) {
                this.showToast('Transfer limit reached. Please upgrade your plan.', 'error');
            }
            return;
        }

        // Add to queue
        this.uploadQueue.push(...files);
        
        // Start processing if not already
        if (this.uploadQueue.length === files.length) {
            this.processUploadQueue();
        }
    }

    processUploadQueue() {
        if (this.uploadQueue.length === 0) {
            this.elements.fileInput.value = '';
            return;
        }

        const file = this.uploadQueue.shift();
        this.currentUploadFile = file;
        
        this.showUploadProgress();
        this.updateProgress(0);

        // Tell server we're starting a file upload
        this.ws.send(JSON.stringify({
            type: 'file_start',
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || 'application/octet-stream'
        }));
    }

    async sendFileChunks(fileId, fileName) {
        const file = this.currentUploadFile;
        if (!file) return;

        const chunkSize = 64 * 1024; // 64KB chunks
        const totalChunks = Math.ceil(file.size / chunkSize);
        
        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = file.slice(start, end);
            const chunkData = await chunk.arrayBuffer();
            
            // Create packet: fileId (36 bytes) + chunk data
            const header = new TextEncoder().encode(fileId.padEnd(36));
            const packet = new Uint8Array(header.length + chunkData.byteLength);
            packet.set(header, 0);
            packet.set(new Uint8Array(chunkData), header.length);
            
            this.ws.send(packet);
            
            // Small delay to prevent overwhelming
            if (i % 10 === 0) {
                await new Promise(r => setTimeout(r, 5));
            }
        }

        // Tell server upload is complete
        this.ws.send(JSON.stringify({
            type: 'file_complete',
            fileId
        }));
    }

    completeDownload(fileId) {
        const download = this.downloading.get(fileId);
        if (!download) return;

        // Combine chunks into blob
        const blob = new Blob(download.chunks.map(c => new Uint8Array(c)), { 
            type: download.mimeType 
        });
        
        // Check if this is for preview or download
        if (download.forPreview) {
            this.showViewer(fileId, blob);
            this.downloading.delete(fileId);
            return;
        }

        // Trigger download
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = download.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        this.downloading.delete(fileId);
        this.showToast('Download complete!', 'success');
    }

    showUploadProgress() {
        this.elements.uploadProgress.classList.add('show');
        this.updateProgress(0);
    }

    hideUploadProgress() {
        setTimeout(() => {
            this.elements.uploadProgress.classList.remove('show');
        }, 500);
    }

    updateProgress(percent) {
        this.elements.progressFill.style.width = `${percent}%`;
        this.elements.progressPercent.textContent = `${percent}%`;
    }

    renderFiles() {
        const { filesList, fileCount, downloadAll } = this.elements;
        const filesArray = Array.from(this.files.values());
        
        fileCount.textContent = filesArray.length;
        downloadAll.style.display = filesArray.length > 1 ? 'block' : 'none';

        if (filesArray.length === 0) {
            filesList.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
                        <polyline points="13,2 13,9 20,9"/>
                    </svg>
                    <p>No files yet</p>
                </div>
            `;
            return;
        }

        filesList.innerHTML = filesArray.map(file => this.createFileItemHTML(file)).join('');

        filesList.querySelectorAll('.btn-view').forEach(btn => {
            btn.addEventListener('click', () => this.viewFile(btn.dataset.fileId));
        });

        filesList.querySelectorAll('.btn-download').forEach(btn => {
            btn.addEventListener('click', () => this.downloadFile(btn.dataset.fileId));
        });

        filesList.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', () => this.deleteFile(btn.dataset.fileId));
        });
    }

    createFileItemHTML(file) {
        const fileType = this.getFileType(file.mimetype);
        const fileSize = this.formatFileSize(file.size);
        const iconHTML = this.getFileIconHTML(fileType, file);
        const canPreview = fileType === 'image' || fileType === 'video';

        return `
            <div class="file-item" data-file-id="${file.id}">
                <div class="file-icon ${fileType}">
                    ${iconHTML}
                </div>
                <div class="file-info">
                    <div class="file-name">${this.escapeHtml(file.originalName)}</div>
                    <div class="file-meta">${fileSize}</div>
                </div>
                <div class="file-actions">
                    ${canPreview ? `
                    <button class="btn-view" data-file-id="${file.id}" title="View">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    </button>
                    ` : ''}
                    <button class="btn-download" data-file-id="${file.id}" data-url="${file.downloadUrl}" data-name="${this.escapeHtml(file.originalName)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                            <polyline points="7,10 12,15 17,10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </button>
                    <button class="btn-delete" data-file-id="${file.id}" title="Remove">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    getFileType(mimetype) {
        if (!mimetype) return 'other';
        if (mimetype.startsWith('image/')) return 'image';
        if (mimetype.startsWith('video/')) return 'video';
        if (mimetype.startsWith('application/pdf') || 
            mimetype.startsWith('application/msword') ||
            mimetype.startsWith('application/vnd.') ||
            mimetype.startsWith('text/')) return 'document';
        return 'other';
    }

    getFileIconHTML(fileType, file) {
        const icons = {
            image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
            video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
            document: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
            other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>'
        };

        return icons[fileType] || icons.other;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async viewFile(fileId) {
        const file = this.files.get(fileId);
        if (!file) return;

        const fileType = this.getFileType(file.mimetype);
        if (fileType !== 'image' && fileType !== 'video') {
            this.showToast('Preview not available for this file type', 'info');
            return;
        }

        this.currentViewFileId = fileId;
        
        // Request file for preview
        this.viewMode = true;
        this.ws.send(JSON.stringify({
            type: 'request_file',
            fileId,
            forPreview: true
        }));

        this.showToast('Loading preview...', 'info');
    }

    showViewer(fileId, blob) {
        const file = this.files.get(fileId);
        if (!file) return;

        const fileType = this.getFileType(file.mimetype);
        const modal = document.getElementById('viewerModal');
        const image = document.getElementById('viewerImage');
        const video = document.getElementById('viewerVideo');
        const filename = document.getElementById('viewerFilename');

        filename.textContent = file.originalName;

        const url = URL.createObjectURL(blob);

        if (fileType === 'video') {
            image.style.display = 'none';
            video.style.display = 'block';
            video.src = url;
        } else {
            video.style.display = 'none';
            video.src = '';
            image.style.display = 'block';
            image.src = url;
        }

        modal.classList.add('show');
        document.body.style.overflow = 'hidden';

        // Store for cleanup
        this.currentViewerUrl = url;
    }

    closeViewer() {
        const modal = document.getElementById('viewerModal');
        const video = document.getElementById('viewerVideo');
        
        modal.classList.remove('show');
        document.body.style.overflow = '';
        video.pause();
        video.src = '';

        if (this.currentViewerUrl) {
            URL.revokeObjectURL(this.currentViewerUrl);
            this.currentViewerUrl = null;
        }
        this.currentViewFileId = null;
    }

    async downloadFile(fileId) {
        const file = this.files.get(fileId);
        if (!file) return;

        this.viewMode = false;
        // Request file from server via WebSocket
        this.ws.send(JSON.stringify({
            type: 'request_file',
            fileId
        }));

        this.showToast('Starting download...', 'info');
    }

    async downloadAllFiles() {
        const filesArray = Array.from(this.files.values());
        for (const file of filesArray) {
            await this.downloadFile(file.id);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    async deleteFile(fileId) {
        this.ws.send(JSON.stringify({
            type: 'delete_file',
            fileId
        }));
        this.files.delete(fileId);
        this.renderFiles();
        this.showToast('File removed', 'info');
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = {
            success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
            error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
        };

        toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
        this.elements.toastContainer.appendChild(toast);

        // Remove toast after 3 seconds
        setTimeout(() => {
            toast.style.animation = 'slideUp 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// Star Rating & Feedback System
class FeedbackSystem {
    constructor() {
        this.selectedRating = 0;
        this.init();
    }

    init() {
        this.stars = document.querySelectorAll('.star');
        this.feedbackText = document.getElementById('feedbackText');
        this.submitBtn = document.getElementById('submitFeedback');

        if (!this.stars.length || !this.submitBtn) return;

        this.stars.forEach(star => {
            star.addEventListener('click', () => this.selectRating(parseInt(star.dataset.value)));
            star.addEventListener('mouseenter', () => this.hoverRating(parseInt(star.dataset.value)));
            star.addEventListener('mouseleave', () => this.resetHover());
        });

        this.submitBtn.addEventListener('click', () => this.submitFeedback());
    }

    selectRating(value) {
        this.selectedRating = value;
        this.stars.forEach(star => {
            const starValue = parseInt(star.dataset.value);
            star.classList.toggle('selected', starValue <= value);
        });
    }

    hoverRating(value) {
        this.stars.forEach(star => {
            const starValue = parseInt(star.dataset.value);
            star.classList.toggle('hovered', starValue <= value);
        });
    }

    resetHover() {
        this.stars.forEach(star => star.classList.remove('hovered'));
    }

    async submitFeedback() {
        if (this.selectedRating === 0) {
            window.easeTransfer?.showToast('Please select a star rating', 'error');
            return;
        }

        const feedback = this.feedbackText?.value.trim() || '';
        
        // Disable button while sending
        this.submitBtn.disabled = true;
        this.submitBtn.innerHTML = `
            <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" stroke-dasharray="60" stroke-dashoffset="20"/>
            </svg>
            Sending...
        `;

        try {
            const response = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rating: this.selectedRating,
                    feedback: feedback
                })
            });

            const result = await response.json();

            if (result.success) {
                window.easeTransfer?.showToast('Thank you for your feedback! 🎉', 'success');
                
                // Reset form
                this.selectedRating = 0;
                this.stars.forEach(star => star.classList.remove('selected'));
                if (this.feedbackText) this.feedbackText.value = '';
            } else {
                window.easeTransfer?.showToast('Failed to send feedback', 'error');
            }
        } catch (err) {
            console.error('Feedback error:', err);
            window.easeTransfer?.showToast('Failed to send feedback', 'error');
        }

        // Re-enable button
        this.submitBtn.disabled = false;
        this.submitBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
            Send Feedback
        `;
    }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    window.subscriptionSystem = new SubscriptionSystem();
    window.paymentSystem = new PaymentSystem();
    window.easeTransfer = new EaseTransfer();
    window.feedbackSystem = new FeedbackSystem();
});
