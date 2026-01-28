// easeTransfer - Fast Local File Transfer
class EaseTransfer {
    constructor() {
        this.ws = null;
        this.deviceId = null;
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
        this.connectWebSocket();
        this.loadServerInfo();
        this.detectDeviceType();
    }

    setupElements() {
        this.elements = {
            connectionStatus: document.getElementById('connectionStatus'),
            statusDot: document.querySelector('.status-dot'),
            statusText: document.querySelector('.status-text'),
            networkUrl: document.getElementById('networkUrl'),
            deviceCount: document.getElementById('deviceCount'),
            toggleQR: document.getElementById('toggleQR'),
            qrContainer: document.getElementById('qrContainer'),
            qrCode: document.getElementById('qrCode'),
            copyUrl: document.getElementById('copyUrl'),
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

        // QR Toggle
        this.elements.toggleQR.addEventListener('click', () => {
            this.elements.qrContainer.classList.toggle('show');
        });

        // Copy URL
        this.elements.copyUrl.addEventListener('click', () => this.copyUrl());

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

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;

        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.reconnectAttempts = 0;
            this.updateConnectionStatus('connected');
            
            this.ws.send(JSON.stringify({
                type: 'register',
                deviceName: this.deviceName,
                deviceType: this.deviceType
            }));
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
            case 'registered':
                this.deviceId = message.deviceId;
                this.updateDeviceCount(message.connectedDevices);
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
                    received: 0
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

    async loadServerInfo() {
        try {
            const qrResponse = await fetch('/api/qrcode');
            const qrData = await qrResponse.json();
            
            this.elements.qrCode.src = qrData.qrCode;
            this.elements.networkUrl.textContent = qrData.url;
            
            const filesResponse = await fetch('/api/files');
            const files = await filesResponse.json();
            files.forEach(f => this.files.set(f.id, f));
            this.renderFiles();
            
        } catch (err) {
            console.error('Failed to load server info:', err);
        }
    }

    async uploadFiles(fileList) {
        const files = Array.from(fileList);
        if (files.length === 0) return;

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
                    <button class="btn-download" data-file-id="${file.id}" data-url="${file.downloadUrl}" data-name="${this.escapeHtml(file.originalName)}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                            <polyline points="7,10 12,15 17,10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Save
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

    async downloadFile(fileId) {
        const file = this.files.get(fileId);
        if (!file) return;

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

    copyUrl() {
        const url = this.elements.networkUrl.textContent;
        navigator.clipboard.writeText(url).then(() => {
            this.showToast('URL copied!', 'success');
        }).catch(() => {
            this.showToast('Failed to copy URL', 'error');
        });
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

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    window.easeTransfer = new EaseTransfer();
});
