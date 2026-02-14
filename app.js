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
        messagesLoaded: false,
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
                    this.messagesLoaded = true;
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
                this.messagesLoaded = true;
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
                    telemetry: null,
                    currentBattery: null
                }));
                
                await Promise.all(this.repeaters.map(r => this.fetchRepeaterTelemetry(r)));
                this.$nextTick(() => this.renderCharts());
            } catch (err) {
                console.error(err);
            } finally {
                this.repeatersLoading = false;
            }
        },

        async fetchRepeaterTelemetry(repeater) {
            const token = localStorage.getItem('api_token');
            const to = new Date();
            const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
            
            const formatDate = (d) => d.toISOString().replace('T', ' ').substring(0, 19);
            
            try {
                const response = await fetch(
                    `${API_BASE}/api/telemetry/history/${repeater.id}?from=${encodeURIComponent(formatDate(from))}&to=${encodeURIComponent(formatDate(to))}&keys=battery_voltage,battery_percentage`,
                    { headers: { 'x-api-token': token } }
                );

                if (response.status === 401) {
                    this.handleUnauthorized();
                    return;
                }

                if (!response.ok) return;

                const data = await response.json();
                const telemetry = this.processTelemetryData(data);
                const lastPct = telemetry.percentage.filter(v => v != null).pop();
                const idx = this.repeaters.findIndex(r => r.id === repeater.id);
                if (idx !== -1) {
                    this.repeaters[idx] = {
                        ...this.repeaters[idx],
                        telemetry: telemetry,
                        currentBattery: lastPct != null ? lastPct : null,
                        lastReadingTime: telemetry.lastReadingTime
                    };
                }
            } catch (err) {
                console.error('Error fetching telemetry for', repeater.name, err);
            }
        },

        processTelemetryData(data) {
            const voltageRecords = data.data?.battery_voltage || [];
            const percentageRecords = data.data?.battery_percentage || [];
            
            const allTimes = new Set();
            percentageRecords.forEach(r => allTimes.add(r.date));
            voltageRecords.forEach(r => allTimes.add(r.date));
            
            const sortedTimes = Array.from(allTimes).sort();
            
            const maxPoints = 50;
            const step = Math.max(1, Math.floor(sortedTimes.length / maxPoints));
            
            const percentageMap = new Map(percentageRecords.map(r => [r.date, parseFloat(r.value)]));
            const voltageMap = new Map(voltageRecords.map(r => [r.date, parseFloat(r.value)]));
            
            const percentage = [];
            const voltage = [];
            const labels = [];
            const lastReadingTime = sortedTimes.length > 0 ? sortedTimes[sortedTimes.length - 1] : null;
            const lastReadingFormatted = lastReadingTime ? this.formatLastReadingTime(lastReadingTime) : 'N/A';
            
            for (let i = 0; i < sortedTimes.length; i += step) {
                const time = sortedTimes[i];
                labels.push(this.formatTelemetryTime(time));
                
                const pct = percentageMap.get(time);
                percentage.push(pct != null ? pct : null);
                
                const volt = voltageMap.get(time);
                voltage.push(volt != null ? volt : null);
            }
            
            return { percentage, voltage, labels, lastReadingTime, lastReadingFormatted };
        },

        formatTelemetryTime(ts) {
            const d = new Date(ts);
            return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
        },

        getBatteryClass(battery) {
            if (battery == null) return 'text-gray-500 dark:text-gray-400';
            if (battery > 50) return 'text-green-600 dark:text-green-400';
            if (battery > 20) return 'text-yellow-600 dark:text-yellow-400';
            return 'text-red-600 dark:text-red-400';
        },

        formatLastReadingTime(ts) {
            if (!ts) return '';
            const date = new Date(ts);
            
            const timeStr = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
            
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const readingDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            const diffDays = Math.floor((today - readingDate) / (1000 * 60 * 60 * 24));
            
            if (diffDays === 0) {
                return `Today at ${timeStr}`;
            } else if (diffDays === 1) {
                return `Yesterday at ${timeStr}`;
            } else {
                const day = date.getDate().toString().padStart(2, '0');
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                const year = date.getFullYear();
                return `${timeStr} on ${day}.${month}.${year}`;
            }
        },

        renderCharts() {
            this.destroyCharts();
            const isDark = this.darkMode;
            const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
            const textColor = isDark ? '#9ca3af' : '#6b7280';

            this.repeaters.forEach(repeater => {
                const canvas = document.getElementById(`chart-${repeater.id}`);
                if (!canvas || !repeater.telemetry || repeater.telemetry.labels.length === 0) return;

                const ctx = canvas.getContext('2d');
                const telemetry = repeater.telemetry;
                
                const pctValues = telemetry.percentage;
                const voltValues = telemetry.voltage;
                
                const datasets = [];
                
                const hasPct = pctValues.some(v => v != null);
                const hasVolt = voltValues.some(v => v != null);
                
                if (hasPct) {
                    const pctGradient = ctx.createLinearGradient(0, 0, 0, 160);
                    pctGradient.addColorStop(0, 'rgba(34, 197, 94, 0.3)');
                    pctGradient.addColorStop(0.5, 'rgba(234, 179, 8, 0.3)');
                    pctGradient.addColorStop(1, 'rgba(239, 68, 68, 0.3)');
                    
                    datasets.push({
                        label: 'Battery %',
                        data: pctValues,
                        borderColor: '#22c55e',
                        backgroundColor: pctGradient,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        borderWidth: 2,
                        yAxisID: 'y',
                        spanGaps: true
                    });
                }
                
                if (hasVolt) {
                    datasets.push({
                        label: 'Voltage',
                        data: voltValues,
                        borderColor: '#3b82f6',
                        backgroundColor: 'transparent',
                        fill: false,
                        tension: 0.4,
                        pointRadius: 0,
                        borderWidth: 2,
                        yAxisID: 'y1',
                        borderDash: [5, 5],
                        spanGaps: true
                    });
                }

                this.repeaterCharts[repeater.id] = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: telemetry.labels,
                        datasets
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: {
                            mode: 'index',
                            intersect: false
                        },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => {
                                        if (ctx.dataset.label === 'Battery %') {
                                            return `Battery: ${ctx.parsed.y.toFixed(1)}%`;
                                        }
                                        return `Voltage: ${ctx.parsed.y.toFixed(2)}V`;
                                    }
                                }
                            }
                        },
                        scales: {
                            x: {
                                display: true,
                                grid: { display: false },
                                ticks: { 
                                    color: textColor,
                                    font: { size: 9 },
                                    maxTicksLimit: 5
                                }
                            },
                            y: {
                                type: 'linear',
                                display: true,
                                position: 'left',
                                min: 0,
                                max: 100,
                                grid: { color: gridColor },
                                ticks: { 
                                    color: textColor,
                                    font: { size: 9 },
                                    callback: (v) => v + '%',
                                    maxTicksLimit: 4
                                }
                            },
y1: {
                                 type: 'linear',
                                 display: hasVolt,
                                 position: 'right',
                                 min: 3.2,
                                 max: 4.2,
                                 grid: { drawOnChartArea: false },
                                 ticks: { 
                                     color: '#3b82f6',
                                     font: { size: 9 },
                                     callback: (v) => v.toFixed(1) + 'V',
                                     maxTicksLimit: 4
                                 }
                             }
                        }
                    }
                });
            });
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
            this.messagesLoaded = false;
            this.updateUrl();
            this.fetchMessages().then(() => {
                this.messagesLoaded = true;
            });
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
            const date = new Date(ts + 'Z');
            return date.toLocaleTimeString('en-GB', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false
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
            this.messagesLoaded = false;
            window.location.hash = '';
        }
    };
}
