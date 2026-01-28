// easeTransfer - Fast Local File Transfer
class EaseTransfer {
    constructor() {
        this.ws = null;
        this.deviceId = null;
        this.files = [];
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        
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
        // Check for saved theme or system preference
        const savedTheme = localStorage.getItem('theme');
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const theme = savedTheme || (systemDark ? 'dark' : 'light');
        
        document.documentElement.setAttribute('data-theme', theme);
        this.updateThemeColor(theme);

        // Listen for system theme changes
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

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.reconnectAttempts = 0;
            this.updateConnectionStatus('connected');
            
            // Register device
            this.ws.send(JSON.stringify({
                type: 'register',
                deviceName: this.deviceName,
                deviceType: this.deviceType
            }));
        };

        this.ws.onmessage = (event) => {
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
            
            // Attempt to reconnect
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                setTimeout(() => this.connectWebSocket(), 2000 * this.reconnectAttempts);
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
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

            case 'new_files':
                this.addFiles(message.files);
                this.showToast(`${message.files.length} file(s) received!`, 'success');
                break;

            case 'existing_files':
                this.files = message.files;
                this.renderFiles();
                break;

            case 'file_removed':
                this.removeFile(message.fileId);
                break;

            case 'file_downloaded':
                // Could show notification that someone downloaded a file
                break;

            case 'pong':
                // Keep-alive response
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
            // Load QR code
            const qrResponse = await fetch('/api/qrcode');
            const qrData = await qrResponse.json();
            
            this.elements.qrCode.src = qrData.qrCode;
            this.elements.networkUrl.textContent = qrData.url;
            
            // Load existing files
            const filesResponse = await fetch('/api/files');
            const files = await filesResponse.json();
            this.files = files;
            this.renderFiles();
            
        } catch (err) {
            console.error('Failed to load server info:', err);
        }
    }

    async uploadFiles(fileList) {
        const files = Array.from(fileList);
        if (files.length === 0) return;

        const formData = new FormData();
        files.forEach(file => formData.append('files', file));
        formData.append('uploaderId', this.deviceId);

        this.showUploadProgress();

        try {
            const xhr = new XMLHttpRequest();
            
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    this.updateProgress(percent);
                }
            };

            xhr.onload = () => {
                this.hideUploadProgress();
                
                if (xhr.status === 200) {
                    const response = JSON.parse(xhr.responseText);
                    this.addFiles(response.files);
                    this.showToast(`${files.length} file(s) uploaded successfully!`, 'success');
                    this.elements.fileInput.value = '';
                } else {
                    this.showToast('Upload failed. Please try again.', 'error');
                }
            };

            xhr.onerror = () => {
                this.hideUploadProgress();
                this.showToast('Upload failed. Please check your connection.', 'error');
            };

            xhr.open('POST', '/api/upload');
            xhr.send(formData);
            
        } catch (err) {
            this.hideUploadProgress();
            this.showToast('Upload failed. Please try again.', 'error');
            console.error('Upload error:', err);
        }
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

    addFiles(newFiles) {
        this.files = [...this.files, ...newFiles];
        this.renderFiles();
    }

    removeFile(fileId) {
        this.files = this.files.filter(f => f.id !== fileId);
        this.renderFiles();
    }

    renderFiles() {
        const { filesList, fileCount, downloadAll } = this.elements;
        
        fileCount.textContent = this.files.length;
        downloadAll.style.display = this.files.length > 1 ? 'block' : 'none';

        if (this.files.length === 0) {
            filesList.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
                        <polyline points="13,2 13,9 20,9"/>
                    </svg>
                    <p>No files shared yet</p>
                    <span>Upload files to share with connected devices</span>
                </div>
            `;
            return;
        }

        filesList.innerHTML = this.files.map(file => this.createFileItemHTML(file)).join('');

        // Add event listeners for file actions
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
        const file = this.files.find(f => f.id === fileId);
        if (!file) return;

        try {
            // Create a link and trigger download
            const link = document.createElement('a');
            link.href = file.downloadUrl;
            link.download = file.originalName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Notify server that file was downloaded
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'file_downloaded',
                    fileId
                }));
            }

            this.showToast('Download started!', 'success');
        } catch (err) {
            console.error('Download error:', err);
            this.showToast('Download failed', 'error');
        }
    }

    async downloadAllFiles() {
        for (const file of this.files) {
            await this.downloadFile(file.id);
            // Small delay between downloads
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    async deleteFile(fileId) {
        try {
            await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
            this.removeFile(fileId);
            this.showToast('File removed', 'info');
        } catch (err) {
            console.error('Delete error:', err);
            this.showToast('Failed to remove file', 'error');
        }
    }

    copyUrl() {
        const url = this.elements.networkUrl.textContent;
        navigator.clipboard.writeText(url).then(() => {
            this.showToast('URL copied to clipboard!', 'success');
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
