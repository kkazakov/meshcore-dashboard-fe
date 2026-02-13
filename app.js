const API_BASE = 'http://127.0.0.1:8000';

function app() {
    return {
        view: 'loading',
        loading: false,
        error: null,
        credentials: {
            email: '',
            password: ''
        },
        user: {
            email: '',
            username: '',
            deviceName: ''
        },
        channels: [],
        channelsLoading: false,
        selectedChannel: 'Public',
        selectedChannelIndex: 0,
        messages: [],
        messagesLoading: false,
        lastMessageTimestamp: null,
        pollerInterval: null,
        newMessage: '',
        sending: false,
        darkMode: false,
        currentPage: 'messages',
        repeaters: [],
        repeatersLoading: false,
        repeaterCharts: {},

        async init() {
            this.loadTheme();
            this.applyTheme();
            
            const token = localStorage.getItem('api_token');
            const userData = localStorage.getItem('user');
            
            if (token && userData) {
                this.user = JSON.parse(userData);
                const valid = await this.verifyToken();
                if (valid) {
                    this.view = 'dashboard';
                    await this.fetchChannels();
                    this.loadChannelFromUrl();
                    await this.fetchMessages();
                    this.startPoller();
                    this.$nextTick(() => this.focusInput());
                } else {
                    this.clearSession();
                    this.view = 'login';
                }
            } else {
                this.view = 'login';
            }
        },

        loadTheme() {
            const savedTheme = localStorage.getItem('darkMode');
            if (savedTheme !== null) {
                this.darkMode = savedTheme === 'true';
            } else {
                this.darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
            }
        },

        applyTheme() {
            if (this.darkMode) {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
        },

        toggleTheme() {
            this.darkMode = !this.darkMode;
            localStorage.setItem('darkMode', this.darkMode);
            this.applyTheme();
            if (this.currentPage === 'telemetry' && this.repeaters.length > 0) {
                this.$nextTick(() => this.renderCharts());
            }
        },

        loadChannelFromUrl() {
            const hash = window.location.hash;
            const match = hash.match(/#channel-(\d+)/);
            if (match) {
                const index = parseInt(match[1], 10);
                const channel = this.channels.find(c => c.index === index);
                if (channel) {
                    this.selectedChannelIndex = index;
                    this.selectedChannel = channel.name;
                }
            }
        },

        updateUrl() {
            window.location.hash = `channel-${this.selectedChannelIndex}`;
        },

        async login() {
            this.loading = true;
            this.error = null;

            try {
                const response = await fetch(`${API_BASE}/api/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.credentials)
                });

                if (!response.ok) {
                    const data = await response.json().catch(() => ({}));
                    throw new Error(data.detail || 'Login failed');
                }

                const data = await response.json();
                localStorage.setItem('api_token', data.token);
                localStorage.setItem('user', JSON.stringify({
                    email: data.email,
                    username: data.username,
                    deviceName: data.device_name
                }));

                this.user = { email: data.email, username: data.username, deviceName: data.device_name };
                this.credentials = { email: '', password: '' };
                this.view = 'dashboard';
                
                await this.fetchChannels();
                this.loadChannelFromUrl();
                await this.fetchMessages();
                this.startPoller();
                this.$nextTick(() => this.focusInput());
            } catch (err) {
                this.error = err.message;
            } finally {
                this.loading = false;
            }
        },

        async verifyToken() {
            const token = localStorage.getItem('api_token');
            if (!token) return false;

            try {
                const response = await fetch(`${API_BASE}/status`, {
                    headers: { 'x-api-token': token }
                });
                if (!response.ok) return false;
                const data = await response.json();
                return data.authenticated === true;
            } catch {
                return false;
            }
        },

        async fetchChannels() {
            this.channelsLoading = true;
            const token = localStorage.getItem('api_token');
            try {
                const response = await fetch(`${API_BASE}/api/channels`, {
                    headers: { 'x-api-token': token }
                });

                if (response.status === 401) {
                    this.handleUnauthorized();
                    return;
                }

                if (!response.ok) {
                    throw new Error('Failed to fetch channels');
                }

                const data = await response.json();
                this.channels = data.channels || [];
            } finally {
                this.channelsLoading = false;
            }
        },

        async fetchRepeaters() {
            this.repeatersLoading = true;
            const token = localStorage.getItem('api_token');
            
            try {
                const response = await fetch(`${API_BASE}/api/repeaters`, {
                    headers: { 'x-api-token': token }
                });

                if (response.status === 401) {
                    this.handleUnauthorized();
                    return;
                }

                if (!response.ok) {
                    throw new Error('Failed to fetch repeaters');
                }

                const data = await response.json();
                this.repeaters = (data.repeaters || []).map(r => ({
                    ...r,
                    batteryHistory: this.generateBatteryHistory(),
                    currentBattery: 0
                }));
                this.repeaters.forEach(r => {
                    r.currentBattery = r.batteryHistory[r.batteryHistory.length - 1];
                });
                this.$nextTick(() => this.renderCharts());
            } catch (err) {
                console.error(err);
            } finally {
                this.repeatersLoading = false;
            }
        },

        generateBatteryHistory() {
            const points = 24;
            const history = [];
            let battery = 75 + Math.random() * 20;
            
            for (let i = 0; i < points; i++) {
                const cyclePhase = (i / points) * 2 * Math.PI;
                const discharge = Math.sin(cyclePhase) * 25;
                const noise = (Math.random() - 0.5) * 5;
                battery = Math.max(10, Math.min(100, 70 + discharge + noise));
                history.push(parseFloat(battery.toFixed(1)));
            }
            return history;
        },

        renderCharts() {
            this.destroyCharts();
            const isDark = this.darkMode;
            const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
            const textColor = isDark ? '#9ca3af' : '#6b7280';

            this.repeaters.forEach(repeater => {
                const canvas = document.getElementById(`chart-${repeater.id}`);
                if (!canvas) return;

                const ctx = canvas.getContext('2d');
                this.repeaterCharts[repeater.id] = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: this.generateTimeLabels(),
                        datasets: [{
                            data: repeater.batteryHistory,
                            borderColor: '#6366f1',
                            backgroundColor: 'rgba(99, 102, 241, 0.1)',
                            fill: true,
                            tension: 0.4,
                            pointRadius: 0,
                            borderWidth: 2
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => `${ctx.parsed.y.toFixed(1)}%`
                                }
                            }
                        },
                        scales: {
                            x: {
                                display: true,
                                grid: { display: false },
                                ticks: { 
                                    color: textColor,
                                    font: { size: 10 },
                                    maxTicksLimit: 6
                                }
                            },
                            y: {
                                display: true,
                                min: 0,
                                max: 100,
                                grid: { color: gridColor },
                                ticks: { 
                                    color: textColor,
                                    font: { size: 10 },
                                    callback: (v) => v + '%',
                                    maxTicksLimit: 4
                                }
                            }
                        }
                    }
                });
            });
        },

        generateTimeLabels() {
            const labels = [];
            const now = new Date();
            for (let i = 23; i >= 0; i--) {
                const time = new Date(now - i * 3600000);
                labels.push(time.getHours().toString().padStart(2, '0') + ':00');
            }
            return labels;
        },

        destroyCharts() {
            Object.values(this.repeaterCharts).forEach(chart => chart?.destroy());
            this.repeaterCharts = {};
        },

        switchPage(page) {
            this.currentPage = page;
            if (page === 'telemetry' && this.repeaters.length === 0) {
                this.fetchRepeaters();
            } else if (page === 'telemetry' && this.repeaters.length > 0) {
                this.$nextTick(() => this.renderCharts());
            } else if (page === 'messages') {
                this.destroyCharts();
            }
        },

        async fetchMessages() {
            this.messagesLoading = true;
            const token = localStorage.getItem('api_token');
            
            try {
                const response = await fetch(
                    `${API_BASE}/api/messages?channel=${encodeURIComponent(this.selectedChannel)}&from=0&limit=100&order=desc`,
                    { headers: { 'x-api-token': token } }
                );

                if (response.status === 401) {
                    this.handleUnauthorized();
                    return;
                }

                if (!response.ok) {
                    throw new Error('Failed to fetch messages');
                }

                const data = await response.json();
                this.messages = (data.messages || []).reverse();
                if (this.messages.length > 0) {
                    this.lastMessageTimestamp = this.messages[this.messages.length - 1].ts;
                }
                this.$nextTick(() => this.scrollToBottom());
            } catch (err) {
                console.error(err);
            } finally {
                this.messagesLoading = false;
            }
        },

        startPoller() {
            this.stopPoller();
            this.pollerInterval = setInterval(() => this.pollNewMessages(), 2000);
        },

        stopPoller() {
            if (this.pollerInterval) {
                clearInterval(this.pollerInterval);
                this.pollerInterval = null;
            }
        },

        async pollNewMessages() {
            if (!this.lastMessageTimestamp) return;
            
            const token = localStorage.getItem('api_token');
            
            try {
                const response = await fetch(
                    `${API_BASE}/api/messages?channel=${encodeURIComponent(this.selectedChannel)}&since=${encodeURIComponent(this.lastMessageTimestamp)}&order=desc`,
                    { headers: { 'x-api-token': token } }
                );

                if (response.status === 401) {
                    this.handleUnauthorized();
                    return;
                }

                if (!response.ok) return;

                const data = await response.json();
                const rawMessages = data.messages || [];
                const newMessages = rawMessages.filter(msg => msg.ts > this.lastMessageTimestamp).reverse();
                
                if (newMessages.length > 0) {
                    this.messages = [...this.messages, ...newMessages];
                    this.lastMessageTimestamp = newMessages[newMessages.length - 1].ts;
                    this.$nextTick(() => this.scrollToBottom());
                }
            } catch (err) {
                console.error(err);
            }
        },

        handleUnauthorized() {
            this.stopPoller();
            this.destroyCharts();
            this.clearSession();
            this.view = 'login';
        },

        async sendMessage() {
            if (!this.newMessage.trim() || this.sending) return;
            
            this.sending = true;
            const token = localStorage.getItem('api_token');

            try {
                const response = await fetch(`${API_BASE}/api/messages`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-api-token': token 
                    },
                    body: JSON.stringify({
                        channel: this.selectedChannel,
                        message: this.newMessage.trim()
                    })
                });

                if (response.status === 401) {
                    this.handleUnauthorized();
                    return;
                }

                if (!response.ok) {
                    throw new Error('Failed to send message');
                }

                this.newMessage = '';
                await this.fetchMessages();
            } catch (err) {
                console.error(err);
            } finally {
                this.sending = false;
                this.$nextTick(() => this.focusInput());
            }
        },

        selectChannel(index, name) {
            this.selectedChannelIndex = index;
            this.selectedChannel = name;
            this.messages = [];
            this.lastMessageTimestamp = null;
            this.updateUrl();
            this.fetchMessages();
            this.focusInput();
        },

        focusInput() {
            const input = this.$refs.messageInput;
            if (input) {
                input.focus();
            }
        },

        scrollToBottom() {
            const container = this.$refs.messagesContainer;
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        },

        formatTime(ts) {
            const date = new Date(ts);
            return date.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
        },

        isMyMessage(msg) {
            return msg.sender === this.user.deviceName;
        },

        logout() {
            this.stopPoller();
            this.destroyCharts();
            this.clearSession();
            this.view = 'login';
        },

        clearSession() {
            localStorage.removeItem('api_token');
            localStorage.removeItem('user');
            this.user = { email: '', username: '', deviceName: '' };
            this.channels = [];
            this.messages = [];
            this.lastMessageTimestamp = null;
            window.location.hash = '';
        }
    };
}
