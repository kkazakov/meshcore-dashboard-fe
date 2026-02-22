const API_BASE = 'http://127.0.0.1:8000';
const WS_BASE = 'ws://127.0.0.1:8000';

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
        // displayQueue: { [channelName]: [ ...messages ] }
        displayQueue: {},
        wsSocket: null,
        wsReconnectDelay: 1000,
        wsReconnectTimer: null,
        wsAuthenticated: false,
        newMessage: '',
        sending: false,
        MSG_MAX_BYTES: 129,
        messagesLoadingMore: false,
        messagesAllLoaded: false,
        darkMode: false,
        currentPage: 'messages',
        repeaters: [],
        repeatersLoading: false,
        repeaterCharts: {},
        showAddRepeaterModal: false,
        addRepeaterLoading: false,
        addRepeaterError: null,
        newRepeaterForm: { name: '', publicKey: '', password: '' },
        showEditRepeaterModal: false,
        editRepeaterLoading: false,
        editRepeaterError: null,
        editRepeaterForm: { id: null, name: '', publicKey: '' },
        showDeleteRepeaterModal: false,
        deleteRepeaterLoading: false,
        deleteRepeaterTarget: null,
        _polling: false,
        _pollMessage: null,
        _pollMessageTimer: null,
        _telemetryRefreshTimer: null,
        // tab visibility tracking
        _docHidden: false,
        _hiddenUnread: 0,
        _originalTitle: 'Meshcore Dashboard',
        _visibilityHandler: null,
        _stickToBottom: true,


        async init() {
            this.loadTheme();
            this.applyTheme();

            this._originalTitle = document.title;
            this._setupVisibilityHandler();
            
            const token = localStorage.getItem('api_token');
            const userData = localStorage.getItem('user');
            
            if (token && userData) {
                const storedUser = JSON.parse(userData);
                this.user = { 
                    email: storedUser.email || '', 
                    username: storedUser.username || '', 
                    deviceName: storedUser.deviceName || storedUser.device_name || '' 
                };
                const valid = await this.verifyToken();
                if (valid) {
                    this.view = 'dashboard';
                    await this.fetchChannels();
                    this.loadChannelFromUrl();
                    await this.fetchMessages({ forceScrollToBottom: true });
                    this.messagesLoaded = true;
                    this.connectWebSocket();
                    this.$nextTick(() => this.focusInput());
                } else {
                    this.clearSession();
                    this.view = 'login';
                }
            } else {
                this.view = 'login';
            }
        },

        _setupVisibilityHandler() {
            this._visibilityHandler = () => {
                this._docHidden = document.hidden;
                if (!document.hidden) {
                    this._flushQueueForCurrentChannel();
                    this._hiddenUnread = 0;
                    document.title = this._originalTitle;
                }
            };
            document.addEventListener('visibilitychange', this._visibilityHandler);
        },

        _teardownVisibilityHandler() {
            if (this._visibilityHandler) {
                document.removeEventListener('visibilitychange', this._visibilityHandler);
                this._visibilityHandler = null;
            }
        },

        // Returns the total number of queued (unread) messages across all channels
        _totalQueuedCount() {
            return Object.values(this.displayQueue).reduce((sum, arr) => sum + arr.length, 0);
        },

        // Returns the queued count for a specific channel name
        _queuedCountForChannel(channelName) {
            return (this.displayQueue[channelName] || []).length;
        },

        // Flush the display queue for the currently selected channel into visible messages
        _flushQueueForCurrentChannel() {
            const queued = this.displayQueue[this.selectedChannel];
            if (!queued || queued.length === 0) return;

            // Filter out messages we already have (by ts)
            const existingTs = new Set(this.messages.map(m => m.ts));
            const newOnes = queued.filter(m => !existingTs.has(m.ts));
            if (newOnes.length > 0) {
                this.messages = [...this.messages, ...newOnes];
                this.$nextTick(() => this.scrollToBottom());
            }
            // Clear this channel from the queue
            const updated = { ...this.displayQueue };
            delete updated[this.selectedChannel];
            this.displayQueue = updated;
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
            // Check for tab anchors first
            if (hash === '#telemetry') {
                this.switchPage('telemetry');
                return;
            }
            if (hash === '#configuration') {
                this.switchPage('configuration');
                return;
            }
            // Fall back to channel anchor for the messages tab
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
                await this.fetchMessages({ forceScrollToBottom: true });
                this.messagesLoaded = true;
                this.connectWebSocket();
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
            const abort = new AbortController();
            const timer = setTimeout(() => abort.abort(), 10000);
            try {
                const response = await fetch(`${API_BASE}/api/channels`, {
                    headers: { 'x-api-token': token },
                    signal: abort.signal
                });

                if (response.status === 401) {
                    this.handleUnauthorized();
                    return;
                }

                if (!response.ok) throw new Error('Failed to fetch channels');

                const data = await response.json();
                this.channels = data.channels || [];
            } catch (err) {
                console.error('fetchChannels failed:', err.name === 'AbortError' ? 'timeout' : err);
            } finally {
                clearTimeout(timer);
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
                    currentBattery: null,
                    _toggling: false,
                    _deleting: false
                }));
                
                await Promise.all(this.repeaters.map(r => this.fetchRepeaterTelemetry(r)));
                this.$nextTick(() => this.renderCharts());
            } catch (err) {
                console.error(err);
            } finally {
                this.repeatersLoading = false;
            }
        },

        async addRepeater() {
            this.addRepeaterError = null;
            this.addRepeaterLoading = true;
            const token = localStorage.getItem('api_token');

            try {
                const response = await fetch(`${API_BASE}/api/repeaters`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-api-token': token
                    },
                    body: JSON.stringify({
                        name: this.newRepeaterForm.name,
                        public_key: this.newRepeaterForm.publicKey,
                        password: this.newRepeaterForm.password
                    })
                });

                if (response.status === 401) {
                    this.handleUnauthorized();
                    return;
                }

                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    this.addRepeaterError = err.message || 'Failed to add repeater';
                    return;
                }

                // Close modal, reset form, refresh list
                this.showAddRepeaterModal = false;
                this.newRepeaterForm = { name: '', publicKey: '', password: '' };
                await this.fetchRepeaters();
            } catch (err) {
                this.addRepeaterError = 'Network error — please try again';
                console.error(err);
            } finally {
                this.addRepeaterLoading = false;
            }
        },

        openEditRepeaterModal(repeater) {
            this.editRepeaterError = null;
            this.editRepeaterForm = {
                id: repeater.id,
                name: repeater.name,
                publicKey: repeater.public_key || '',
                password: repeater.password || ''
            };
            this.showEditRepeaterModal = true;
        },

        async updateRepeater() {
            this.editRepeaterError = null;
            this.editRepeaterLoading = true;
            const token = localStorage.getItem('api_token');

            try {
                const response = await fetch(`${API_BASE}/api/repeaters/${this.editRepeaterForm.id}`, {
                    method: 'PATCH',
                    headers: {
                        'content-type': 'application/json',
                        'x-api-token': token
                    },
                    body: JSON.stringify({
                        name: this.editRepeaterForm.name,
                        public_key: this.editRepeaterForm.publicKey,
                        password: this.editRepeaterForm.password
                    })
                });

                if (response.status === 401) {
                    this.handleUnauthorized();
                    return;
                }

                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    this.editRepeaterError = err.message || 'Failed to update repeater';
                    return;
                }

                // Update the card in-place so the UI refreshes instantly
                const idx = this.repeaters.findIndex(r => r.id === this.editRepeaterForm.id);
                if (idx !== -1) {
                    this.repeaters[idx] = {
                        ...this.repeaters[idx],
                        name: this.editRepeaterForm.name,
                        public_key: this.editRepeaterForm.publicKey,
                        password: this.editRepeaterForm.password
                    };
                }
                this.showEditRepeaterModal = false;
            } catch (err) {
                this.editRepeaterError = 'Network error — please try again';
                console.error(err);
            } finally {
                this.editRepeaterLoading = false;
            }
        },

        confirmDeleteRepeater(repeater) {
            this.deleteRepeaterTarget = repeater;
            this.showDeleteRepeaterModal = true;
        },

        async deleteRepeater() {
            if (!this.deleteRepeaterTarget) return;
            this.deleteRepeaterLoading = true;
            const token = localStorage.getItem('api_token');
            const id = this.deleteRepeaterTarget.id;

            // Mark card as deleting for visual feedback
            const idx = this.repeaters.findIndex(r => r.id === id);
            if (idx !== -1) this.repeaters[idx] = { ...this.repeaters[idx], _deleting: true };

            try {
                const response = await fetch(`${API_BASE}/api/repeaters/${id}`, {
                    method: 'DELETE',
                    headers: { 'x-api-token': token }
                });

                if (response.status === 401) {
                    this.handleUnauthorized();
                    return;
                }

                if (response.ok) {
                    this.repeaters = this.repeaters.filter(r => r.id !== id);
                    this.showDeleteRepeaterModal = false;
                    this.deleteRepeaterTarget = null;
                } else {
                    console.error('Failed to delete repeater');
                    if (idx !== -1) this.repeaters[idx] = { ...this.repeaters[idx], _deleting: false };
                }
            } catch (err) {
                console.error(err);
                if (idx !== -1) this.repeaters[idx] = { ...this.repeaters[idx], _deleting: false };
            } finally {
                this.deleteRepeaterLoading = false;
            }
        },

        async toggleRepeater(repeater) {
            if (repeater.enabled) {
                await this.disableRepeater(repeater);
            } else {
                await this.enableRepeater(repeater);
            }
        },

        async enableRepeater(repeater) {
            const idx = this.repeaters.findIndex(r => r.id === repeater.id);
            if (idx === -1) return;
            this.repeaters[idx] = { ...this.repeaters[idx], _toggling: true };

            const token = localStorage.getItem('api_token');
            try {
                const response = await fetch(`${API_BASE}/api/repeaters/${repeater.id}/enable`, {
                    method: 'POST',
                    headers: { 'x-api-token': token }
                });

                if (response.status === 401) { this.handleUnauthorized(); return; }

                if (response.ok) {
                    this.repeaters[idx] = { ...this.repeaters[idx], enabled: true, _toggling: false };
                } else {
                    console.error('Failed to enable repeater', repeater.name);
                    this.repeaters[idx] = { ...this.repeaters[idx], _toggling: false };
                }
            } catch (err) {
                console.error(err);
                this.repeaters[idx] = { ...this.repeaters[idx], _toggling: false };
            }
        },

        async pollRepeaters() {
            this._polling = true;
            const token = localStorage.getItem('api_token');
            try {
                const response = await fetch(`${API_BASE}/api/repeaters/poll`, {
                    method: 'POST',
                    headers: { 'x-api-token': token }
                });

                if (response.status === 401) { this.handleUnauthorized(); return; }

                const data = await response.json().catch(() => ({}));
                this._showPollMessage(data.message || (response.ok ? 'Poll started' : 'Poll failed'));
                if (!response.ok) console.error('Failed to poll repeaters');
            } catch (err) {
                console.error(err);
                this._showPollMessage('Network error');
            } finally {
                this._polling = false;
            }
        },

        _showPollMessage(msg) {
            this._pollMessage = msg;
            clearTimeout(this._pollMessageTimer);
            this._pollMessageTimer = setTimeout(() => { this._pollMessage = null; }, 4000);
        },

        async disableRepeater(repeater) {
            const idx = this.repeaters.findIndex(r => r.id === repeater.id);
            if (idx === -1) return;
            this.repeaters[idx] = { ...this.repeaters[idx], _toggling: true };

            const token = localStorage.getItem('api_token');
            try {
                const response = await fetch(`${API_BASE}/api/repeaters/${repeater.id}/disable`, {
                    method: 'POST',
                    headers: { 'x-api-token': token }
                });

                if (response.status === 401) { this.handleUnauthorized(); return; }

                if (response.ok) {
                    this.repeaters[idx] = { ...this.repeaters[idx], enabled: false, _toggling: false };
                } else {
                    console.error('Failed to disable repeater', repeater.name);
                    this.repeaters[idx] = { ...this.repeaters[idx], _toggling: false };
                }
            } catch (err) {
                console.error(err);
                this.repeaters[idx] = { ...this.repeaters[idx], _toggling: false };
            }
        },

        async fetchRepeaterTelemetry(repeater) {
            const token = localStorage.getItem('api_token');
            const to = new Date();
            const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
            
            const formatDate = (d) => d.toISOString().replace('T', ' ').substring(0, 19);
            
            try {
                const response = await fetch(
                    `${API_BASE}/api/telemetry/history/${repeater.id}?from=${encodeURIComponent(formatDate(from))}&to=${encodeURIComponent(formatDate(to))}&keys=battery_voltage,battery_percentage,temperature_c,pressure_hpa,humidity_pct`,
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

        async _refreshTelemetrySilently() {
            if (!this.repeaters.length) return;
            await Promise.all(this.repeaters.map(r => this.fetchRepeaterTelemetry(r)));
            // Patch existing Chart.js instances in-place — no destroy/recreate, no flash
            this.repeaters.forEach(repeater => {
                if (!repeater.telemetry) return;
                const t = repeater.telemetry;

                const batteryChart = this.repeaterCharts[repeater.id];
                if (batteryChart) {
                    batteryChart.data.labels = t.labels;
                    batteryChart.data.datasets.forEach(ds => {
                        if (ds.label === 'Battery %') ds.data = t.percentage;
                        else if (ds.label === 'Voltage') ds.data = t.voltage;
                    });
                    batteryChart.update('none');
                }

                const tempChart = this.repeaterCharts[repeater.id + '-temp'];
                if (tempChart) {
                    tempChart.data.labels = t.labels;
                    tempChart.data.datasets.forEach(ds => { if (ds.label === 'Temperature') ds.data = t.temperature; });
                    tempChart.update('none');
                }

                const presChart = this.repeaterCharts[repeater.id + '-pres'];
                if (presChart) {
                    presChart.data.labels = t.labels;
                    presChart.data.datasets.forEach(ds => { if (ds.label === 'Pressure') ds.data = t.pressure; });
                    presChart.update('none');
                }

                const humChart = this.repeaterCharts[repeater.id + '-hum'];
                if (humChart) {
                    humChart.data.labels = t.labels;
                    humChart.data.datasets.forEach(ds => { if (ds.label === 'Humidity') ds.data = t.humidity; });
                    humChart.update('none');
                }
            });
        },

        _startTelemetryRefresh() {
            this._stopTelemetryRefresh();
            this._telemetryRefreshTimer = setInterval(() => this._refreshTelemetrySilently(), 60_000);
        },

        _stopTelemetryRefresh() {
            if (this._telemetryRefreshTimer) {
                clearInterval(this._telemetryRefreshTimer);
                this._telemetryRefreshTimer = null;
            }
        },

        processTelemetryData(data) {
            const voltageRecords = data.data?.battery_voltage || [];
            const percentageRecords = data.data?.battery_percentage || [];
            const temperatureRecords = data.data?.temperature_c || [];
            const pressureRecords = data.data?.pressure_hpa || [];
            const humidityRecords = data.data?.humidity_pct || [];
            
            const allTimes = new Set();
            percentageRecords.forEach(r => allTimes.add(r.date));
            voltageRecords.forEach(r => allTimes.add(r.date));
            temperatureRecords.forEach(r => allTimes.add(r.date));
            pressureRecords.forEach(r => allTimes.add(r.date));
            humidityRecords.forEach(r => allTimes.add(r.date));
            
            const sortedTimes = Array.from(allTimes).sort();
            
            const maxPoints = 50;
            const step = Math.max(1, Math.floor(sortedTimes.length / maxPoints));
            
            const percentageMap = new Map(percentageRecords.map(r => [r.date, parseFloat(r.value)]));
            const voltageMap = new Map(voltageRecords.map(r => [r.date, parseFloat(r.value)]));
            const temperatureMap = new Map(temperatureRecords.map(r => [r.date, parseFloat(r.value)]));
            const pressureMap = new Map(pressureRecords.map(r => [r.date, parseFloat(r.value)]));
            const humidityMap = new Map(humidityRecords.map(r => [r.date, parseFloat(r.value)]));
            
            const percentage = [];
            const voltage = [];
            const temperature = [];
            const pressure = [];
            const humidity = [];
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

                const temp = temperatureMap.get(time);
                temperature.push(temp != null ? temp : null);

                const pres = pressureMap.get(time);
                pressure.push(pres != null ? pres : null);

                const hum = humidityMap.get(time);
                humidity.push(hum != null ? hum : null);
            }
            
            return { percentage, voltage, temperature, pressure, humidity, labels, lastReadingTime, lastReadingFormatted };
        },

        formatTelemetryTime(ts) {
            const normalised = (ts && !/[Zz]$/.test(ts) && !/[+-]\d{2}:?\d{2}$/.test(ts))
                ? String(ts).replace(' ', 'T') + 'Z'
                : ts;
            const d = new Date(normalised);
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
            const normalised = (ts && !/[Zz]$/.test(ts) && !/[+-]\d{2}:?\d{2}$/.test(ts))
                ? String(ts).replace(' ', 'T') + 'Z'
                : ts;
            const date = new Date(normalised);
            
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
            this.$nextTick(() => this.renderSensorCharts());
        },

        _renderSensorChart(canvas, chartKey, label, labels, values, color, unit, tooltipFn, yOptions) {
            if (!canvas) return;
            const hasData = values.some(v => v != null);
            if (!hasData) return;

            const isDark = this.darkMode;
            const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
            const textColor = isDark ? '#9ca3af' : '#6b7280';

            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            const gradient = ctx.createLinearGradient(0, 0, 0, 160);
            const withAlpha = (a) => color.replace(/,\s*1\)$/, `, ${a})`);
            gradient.addColorStop(0, withAlpha(0.3));
            gradient.addColorStop(1, withAlpha(0.05));

            // Destroy any stale instance (e.g. after theme toggle)
            if (this.repeaterCharts[chartKey]) {
                this.repeaterCharts[chartKey].destroy();
                delete this.repeaterCharts[chartKey];
            }

            this.repeaterCharts[chartKey] = new Chart(ctx, {
                type: 'line',
                data: { labels, datasets: [{
                    label,
                    data: values,
                    borderColor: color,
                    backgroundColor: gradient,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    borderWidth: 2,
                    spanGaps: true
                }]},
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: tooltipFn } }
                    },
                    scales: {
                        x: {
                            display: true,
                            grid: { display: false },
                            ticks: { color: textColor, font: { size: 9 }, maxTicksLimit: 5 }
                        },
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            grid: { color: gridColor },
                            ticks: { color: textColor, font: { size: 9 }, maxTicksLimit: 4,
                                callback: (v) => parseFloat(v.toFixed(1)) + unit },
                            ...yOptions
                        }
                    }
                }
            });
        },

        renderSensorCharts() {
            this.repeaters.forEach(repeater => {
                if (!repeater.telemetry) return;
                const t = repeater.telemetry;

                const renderOne = (suffix, label, values, color, unit, tooltipFn, yOptions) => {
                    if (!values.some(v => v != null)) return;
                    const canvas = document.getElementById(`chart-${repeater.id}-${suffix}`);
                    if (!canvas) return;
                    this._renderSensorChart(canvas, repeater.id + '-' + suffix, label, t.labels, values, color, unit, tooltipFn, yOptions);
                };

                renderOne('temp', 'Temperature', t.temperature,
                    'rgba(249, 115, 22, 1)', '°C',
                    (c) => `Temp: ${c.parsed.y.toFixed(1)}°C`,
                    {}
                );
                renderOne('pres', 'Pressure', t.pressure,
                    'rgba(99, 102, 241, 1)', ' hPa',
                    (c) => `Pressure: ${c.parsed.y.toFixed(1)} hPa`,
                    {}
                );
                renderOne('hum', 'Humidity', t.humidity,
                    'rgba(14, 165, 233, 1)', '%',
                    (c) => `Humidity: ${c.parsed.y.toFixed(1)}%`,
                    { min: 0, max: 100 }
                );
            });
        },

        destroyCharts() {
            Object.values(this.repeaterCharts).forEach(chart => chart?.destroy());
            this.repeaterCharts = {};
        },

        switchPage(page) {
            this.currentPage = page;
            // Update URL anchor to reflect the active tab
            if (page === 'messages') {
                // Restore the channel anchor for the messages tab
                this.updateUrl();
            } else {
                window.location.hash = page;
            }
            if (page === 'telemetry' && this.repeaters.length === 0) {
                this.fetchRepeaters().then(() => this._startTelemetryRefresh());
            } else if (page === 'telemetry' && this.repeaters.length > 0) {
                this.$nextTick(() => this.renderCharts());
                this._startTelemetryRefresh();
            } else {
                this._stopTelemetryRefresh();
                if (page === 'messages') {
                    this.destroyCharts();
                    // When switching back to messages, flush the queue for the current channel
                    this._flushQueueForCurrentChannel();
                }
            }
        },

        async fetchMessages({ forceScrollToBottom = false } = {}) {
            if (this.messagesLoading) return;
            this.messagesLoading = true;
            this.messagesAllLoaded = false;
            const shouldScroll = forceScrollToBottom || this._isAtBottom();
            const token = localStorage.getItem('api_token');
            
            try {
                const response = await fetch(
                    `${API_BASE}/api/messages?channel=${encodeURIComponent(this.selectedChannel)}&from=0&limit=100&order=desc`,
                    { headers: { 'x-api-token': token } }
                );

                if (response.status === 401) { this.handleUnauthorized(); return; }
                if (!response.ok) throw new Error('Failed to fetch messages');

                const data = await response.json();
                this.messages = (data.messages || []).reverse();
                if (this.messages.length > 0) {
                    this.lastMessageTimestamp = this.messages[this.messages.length - 1].ts;
                }
                if (data.count < 100) this.messagesAllLoaded = true;
                // Clear loading flag first so Alpine removes the spinner in the same
                // batch as the new messages — scrollToBottom then sees the final layout.
                this.messagesLoading = false;
                if (shouldScroll) this.$nextTick(() => this.scrollToBottom());
            } catch (err) {
                console.error(err);
                this.messagesLoading = false;
            }
        },

        async loadMoreMessages() {
            if (this.messagesLoadingMore || this.messagesAllLoaded || this.messagesLoading || !this.messagesLoaded) return;

            this.messagesLoadingMore = true;
            const token = localStorage.getItem('api_token');
            const offset = this.messages.length;

            try {
                const response = await fetch(
                    `${API_BASE}/api/messages?channel=${encodeURIComponent(this.selectedChannel)}&from=${offset}&limit=100&order=desc`,
                    { headers: { 'x-api-token': token } }
                );

                if (response.status === 401) { this.handleUnauthorized(); return; }
                if (!response.ok) throw new Error('Failed to fetch messages');

                const data = await response.json();
                const older = (data.messages || []).reverse();

                if (older.length === 0 || data.count < 100) {
                    this.messagesAllLoaded = true;
                }

                if (older.length > 0) {
                    const container = this.$refs.messagesContainer;
                    // Snapshot scroll anchor before prepending so position is preserved
                    const prevHeight = container ? container.scrollHeight : 0;
                    this.messages = [...older, ...this.messages];
                    this.$nextTick(() => {
                        if (container) {
                            container.scrollTop = container.scrollHeight - prevHeight;
                        }
                    });
                }
            } catch (err) {
                console.error(err);
            } finally {
                this.messagesLoadingMore = false;
            }
        },

        // ─── WebSocket ────────────────────────────────────────────────────────────

        connectWebSocket() {
            const token = localStorage.getItem('api_token');
            if (!token) return;

            // Clean up any existing socket
            this.disconnectWebSocket(false);

            const ws = new WebSocket(`${WS_BASE}/ws`);
            this.wsSocket = ws;
            this.wsAuthenticated = false;

            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'auth', token }));
            };

            ws.onmessage = (event) => {
                let message;
                try {
                    message = JSON.parse(event.data);
                } catch {
                    return;
                }

                const msgType = (message.type || '').trim();

                if (msgType === 'welcome') {
                    this.wsReconnectDelay = 1000;
                    this.wsAuthenticated = true;
                    return;
                }

                if (msgType === 'ping') {
                    return;
                }

                if (msgType === 'new_message' && message.data) {
                    this._handleWsMessage(message.data);
                }
            };

            ws.onclose = () => {
                this.wsAuthenticated = false;
                this.wsSocket = null;
                this._scheduleReconnect();
            };

            ws.onerror = () => {
                // onclose will fire after onerror — reconnect logic lives there
            };
        },

        disconnectWebSocket(cancelReconnect = true) {
            if (cancelReconnect && this.wsReconnectTimer) {
                clearTimeout(this.wsReconnectTimer);
                this.wsReconnectTimer = null;
            }
            if (this.wsSocket) {
                // Remove handlers to avoid triggering reconnect on intentional close
                this.wsSocket.onclose = null;
                this.wsSocket.onerror = null;
                this.wsSocket.close();
                this.wsSocket = null;
            }
            this.wsAuthenticated = false;
        },

        _scheduleReconnect() {
            // Only reconnect if we still have a session
            if (!localStorage.getItem('api_token')) return;

            const delay = this.wsReconnectDelay;
            // Exponential back-off capped at 30s
            this.wsReconnectDelay = Math.min(this.wsReconnectDelay * 2, 30000);

            this.wsReconnectTimer = setTimeout(() => {
                this.wsReconnectTimer = null;
                this.connectWebSocket();
            }, delay);
        },

        // Normalise a WS new_message payload into the same shape as REST messages
        _normaliseWsMessage(data) {
            return {
                ts: data.received_at,
                sender: data.sender_name,
                text: data.text,
                hops: data.path_len != null ? data.path_len : 0,
                snr: data.snr,
                channel_idx: data.channel_idx,
                channel_name: data.channel_name,
            };
        },

        _handleWsMessage(data) {
            const msg = this._normaliseWsMessage(data);
            const channelName = data.channel_name;

            const isCurrentChannel = channelName === this.selectedChannel;
            const isMessagesPage = this.currentPage === 'messages';
            const isVisible = !document.hidden;

            if (isCurrentChannel && isMessagesPage && isVisible) {
                // Message is immediately visible — append directly
                const existingTs = new Set(this.messages.map(m => m.ts));
                if (!existingTs.has(msg.ts)) {
                    const wasAtBottom = this._isAtBottom();
                    this.messages = [...this.messages, msg];
                    if (wasAtBottom) this.$nextTick(() => this.scrollToBottom());
                }
            } else {
                // Add to display queue for this channel
                const updated = { ...this.displayQueue };
                if (!updated[channelName]) {
                    updated[channelName] = [];
                }
                // Avoid duplicates
                const alreadyQueued = updated[channelName].some(m => m.ts === msg.ts);
                if (!alreadyQueued) {
                    updated[channelName] = [...updated[channelName], msg];
                }
                this.displayQueue = updated;

                // Update browser title if tab is hidden
                if (document.hidden) {
                    this._hiddenUnread++;
                    document.title = `(${this._hiddenUnread}) ${this._originalTitle}`;
                }
            }
        },

        // ─── End WebSocket ────────────────────────────────────────────────────────

        handleUnauthorized() {
            this.disconnectWebSocket();
            this._stopTelemetryRefresh();
            this.destroyCharts();
            this.clearSession();
            this.view = 'login';
        },

        async sendMessage() {
            if (!this.newMessage.trim() || this.sending) return;
            if (this.msgByteCount() > this.MSG_MAX_BYTES) return;
            
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
            this.messagesLoading = false; // reset any in-flight guard so fetchMessages runs
            this._stickToBottom = true;
            this.updateUrl();
            this.fetchMessages({ forceScrollToBottom: true }).then(() => {
                this.messagesLoaded = true;
                this._flushQueueForCurrentChannel();
            });
            this.focusInput();
        },

        msgByteCount() {
            return new TextEncoder().encode(this.newMessage).length;
        },

        focusInput() {
            const input = this.$refs.messageInput;
            if (input) {
                input.focus();
            }
        },

        scrollToBottom() {
            const el = this.$refs.messagesBottom;
            if (el) {
                el.scrollIntoView();
                this._stickToBottom = true;
            }
        },

        _isAtBottom() {
            const container = this.$refs.messagesContainer;
            if (!container) return true;
            return container.scrollHeight - container.scrollTop - container.clientHeight < 80;
        },

        onMessagesScroll(e) {
            this._stickToBottom = this._isAtBottom();
        },

        formatTime(ts) {
            // Append Z if no timezone is present to ensure UTC parsing
            const normalised = (ts && !/[Zz]$/.test(ts) && !/[+-]\d{2}:?\d{2}$/.test(ts))
                ? ts.replace(' ', 'T') + 'Z'
                : ts;
            return new Date(normalised).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        },

        linkifyText(text) {
            // Escape HTML special chars first to prevent XSS
            const escaped = text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
            // Replace https:// URLs with clickable links
            return escaped.replace(
                /(https:\/\/[^\s<>"]+)/g,
                '<a href="$1" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 opacity-90 hover:opacity-100 break-all">$1</a>'
            );
        },

        extractImageUrls(text) {
            const matches = text.match(/https:\/\/[^\s<>"]+\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s<>"]*)?/gi);
            return matches || [];
        },

        isMyMessage(msg) {
            return msg.sender === this.user.deviceName;
        },

        replyTo(sender) {
            const prefix = `@[${sender}] `;
            // Avoid duplicating the prefix if already present
            if (!this.newMessage.startsWith(prefix)) {
                this.newMessage = prefix + this.newMessage;
            }
            this.$nextTick(() => {
                const input = this.$refs.messageInput;
                if (input) {
                    input.focus();
                    // Move cursor to end
                    input.selectionStart = input.selectionEnd = input.value.length;
                }
            });
        },

        logout() {
            this.disconnectWebSocket();
            this._stopTelemetryRefresh();
            this._teardownVisibilityHandler();
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
            this.displayQueue = {};
            this.lastMessageTimestamp = null;
            this.messagesLoaded = false;
            this._hiddenUnread = 0;
            document.title = this._originalTitle;
            window.location.hash = '';
        }
    };
}
