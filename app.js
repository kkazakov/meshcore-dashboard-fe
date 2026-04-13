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
        currentPage: 'channels',
        moreSubPage: 'telemetry',
        repeaters: [],
        messageLinks: [],
        messageLinksLoading: false,
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
        showDeleteChannelModal: false,
        deleteChannelLoading: false,
        deleteChannelTarget: null,
        softDeleteChannel: false,
        showAddChannelModal: false,
        addChannelLoading: false,
        addChannelError: null,
        addChannelForm: { name: '', password: '' },
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
        unreadChannels: {}, // channel_name → unread count
        icloudImageCache: {}, // shortGUID → blob URL (resolved) | null (failed) | undefined (pending)


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

        // Flush the display queue for the currently selected channel into visible messages
        _flushQueueForCurrentChannel() {
            // No-op - display queue is no longer used
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
            if (this.currentPage === 'more' && this.moreSubPage === 'telemetry' && this.repeaters.length > 0) {
                this.$nextTick(() => this.renderCharts());
            }
        },

        loadChannelFromUrl() {
            const hash = window.location.hash;
            // Check for tab anchors first
            if (hash === '#more') {
                this.switchPage('more');
                return;
            }
            if (hash === '#settings') {
                this.switchPage('settings');
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
                    // Mutate in-place so Alpine doesn't tear down and recreate the
                    // x-for DOM nodes (which would detach the canvases Chart.js holds)
                    Object.assign(this.repeaters[idx], {
                        telemetry: telemetry,
                        currentBattery: lastPct != null ? lastPct : null,
                        lastReadingTime: telemetry.lastReadingTime
                    });
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

                const safeUpdate = (chart, mutateFn) => {
                    if (!chart || !chart.canvas || !chart.canvas.isConnected) return;
                    mutateFn(chart);
                    try { chart.update('none'); } catch (e) { /* stale chart, ignore */ }
                };

                safeUpdate(this.repeaterCharts[repeater.id], chart => {
                    chart.data.labels = t.labels;
                    chart.data.datasets.forEach(ds => {
                        if (ds.label === 'Battery %') ds.data = t.percentage;
                        else if (ds.label === 'Voltage') ds.data = t.voltage;
                    });
                });

                safeUpdate(this.repeaterCharts[repeater.id + '-temp'], chart => {
                    chart.data.labels = t.labels;
                    chart.data.datasets.forEach(ds => { if (ds.label === 'Temperature') ds.data = t.temperature; });
                });

                safeUpdate(this.repeaterCharts[repeater.id + '-pres'], chart => {
                    chart.data.labels = t.labels;
                    chart.data.datasets.forEach(ds => { if (ds.label === 'Pressure') ds.data = t.pressure; });
                });

                safeUpdate(this.repeaterCharts[repeater.id + '-hum'], chart => {
                    chart.data.labels = t.labels;
                    chart.data.datasets.forEach(ds => { if (ds.label === 'Humidity') ds.data = t.humidity; });
                });
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
                        responsive: false,
                        animation: false,
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
            this.renderSensorCharts();
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
                    responsive: false,
                    animation: false,
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
            if (page === 'channels') {
                // Restore the channel anchor for the channels tab
                this.updateUrl();
            } else {
                window.location.hash = page;
            }
            if (page === 'more' && this.moreSubPage === 'telemetry' && this.repeaters.length === 0) {
                this.fetchRepeaters().then(() => this._startTelemetryRefresh());
            } else if (page === 'more' && this.moreSubPage === 'telemetry' && this.repeaters.length > 0) {
                this.$nextTick(() => this.renderCharts());
                this._startTelemetryRefresh();
            } else if (page === 'more' && this.moreSubPage === 'links' && this.messageLinks.length === 0) {
                this.fetchMessageLinks();
            } else {
                this._stopTelemetryRefresh();
                if (page === 'channels') {
                    this.destroyCharts();
                }
            }
        },
        
        switchSubPage(subPage) {
            this.moreSubPage = subPage;
            if (subPage === 'telemetry' && this.repeaters.length === 0) {
                this.fetchRepeaters().then(() => this._startTelemetryRefresh());
            } else if (subPage === 'telemetry' && this.repeaters.length > 0) {
                this.$nextTick(() => this.renderCharts());
                this._startTelemetryRefresh();
            } else if (subPage === 'links' && this.messageLinks.length === 0) {
                this.fetchMessageLinks();
            } else {
                this._stopTelemetryRefresh();
                this.destroyCharts();
            }
        },
        
        async fetchMessageLinks() {
            this.messageLinksLoading = true;
            const token = localStorage.getItem('api_token') || '0bd71fdbcefca62bfca7941ccd43d5437f3b04f82884cd1be3a6ad4e0941038d';
            
            try {
                const response = await fetch(
                    'https://meshcore-dashboard-api.drun.net/api/message-links?from=0&limit=1000',
                    {
                        headers: { 'x-api-token': token }
                    }
                );
                
                if (response.status === 401) {
                    this.handleUnauthorized();
                    return;
                }

                if (!response.ok) {
                    throw new Error('Failed to fetch message links: ' + response.statusText);
                }

                const data = await response.json();
                const links = (data.links || []).reverse();
                this.messageLinks.splice(0, this.messageLinks.length, ...links);
                this.$nextTick(() => this.scrollToLinksBottom());
            } catch (err) {
                console.error('fetchMessageLinks error:', err);
            } finally {
                this.messageLinksLoading = false;
            }
        },

        scrollToLinksBottom() {
            const el = this.$refs.linksBottom;
            if (el) {
                el.scrollIntoView();
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
                this.messages = (data.messages || []).map(m => this._normaliseMessage(m, 'api')).reverse();
                // Kick off iCloud image resolution for any share.icloud.com links
                this.messages.forEach(m => this._resolveICloudUrlsInText(m.text));
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
                const older = (data.messages || []).map(m => this._normaliseMessage(m, 'api')).reverse();
                // Kick off iCloud image resolution for any share.icloud.com links
                older.forEach(m => this._resolveICloudUrlsInText(m.text));

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

            // If a socket is still mid-handshake, don't tear it down and restart —
            // that's what causes "WebSocket closed before connection established".
            if (this.wsSocket && this.wsSocket.readyState === WebSocket.CONNECTING) return;

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

            ws.onclose = (event) => {
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
                // Only close if not already closing/closed
                if (this.wsSocket.readyState !== WebSocket.CLOSING &&
                    this.wsSocket.readyState !== WebSocket.CLOSED) {
                    this.wsSocket.close();
                }
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

        // Normalise a message (from WS or API) into a consistent shape
        _normaliseMessage(data, source = 'api') {
            if (source === 'ws') {
                return {
                    ts: data.received_at,
                    sender: data.sender_name,
                    text: data.text,
                    hops: data.path_len != null ? data.path_len : 0,
                    snr: data.snr,
                    channel_idx: data.channel_idx,
                    channel_name: data.channel_name,
                };
            }
            // API source - map API fields to consistent shape
            return {
                ts: data.ts,
                sender: data.sender,
                text: data.text,
                hops: data.hops != null ? data.hops : 0,
                snr: data.snr,
                channel_idx: data.channel_idx,
                channel_name: data.channel,
            };
        },

        _handleWsMessage(data) {
            const msg = this._normaliseMessage(data, 'ws');
            const channelName = data.channel_name;

            const isCurrentChannel = channelName === this.selectedChannel;
            const isMessagesPage = this.currentPage === 'channels';
            const isTabVisible = !document.hidden;

            // Always try to append if this is the active channel (regardless of tab visibility)
            if (isCurrentChannel && isMessagesPage) {
                const existingTs = new Set(this.messages.map(m => m.ts));
                if (!existingTs.has(msg.ts)) {
                    const wasAtBottom = this._isAtBottom();
                    this._resolveICloudUrlsInText(msg.text);
                    this.messages = [...this.messages, msg];
                    if (wasAtBottom) this.$nextTick(() => this.scrollToBottom());
                }

                // Increment title unread counter when tab is hidden
                if (!isTabVisible) {
                    this._hiddenUnread++;
                    document.title = `(${this._hiddenUnread}) ${this._originalTitle}`;
                }
            } else {
                // Message is for a different channel or user is on another page — mark it unread
                this.unreadChannels = {
                    ...this.unreadChannels,
                    [channelName]: (this.unreadChannels[channelName] || 0) + 1,
                };

                // Also bump the title counter if tab is hidden
                if (!isTabVisible) {
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
            // Clear unread badge for this channel
            if (this.unreadChannels[name]) {
                const updated = { ...this.unreadChannels };
                delete updated[name];
                this.unreadChannels = updated;
            }
            this.messages = [];
            this.lastMessageTimestamp = null;
            this.messagesLoaded = false;
            this.messagesLoading = false; // reset any in-flight guard so fetchMessages runs
            this._stickToBottom = true;
            this.updateUrl();
            this.fetchMessages({ forceScrollToBottom: true }).then(() => {
                this.messagesLoaded = true;
            });
            this.focusInput();
        },

        async addChannel() {
            const name = this.addChannelForm.name.trim();
            if (!name) return;
            this.addChannelLoading = true;
            this.addChannelError = null;
            const token = localStorage.getItem('api_token');
            const isPublic = name.startsWith('#');
            const body = isPublic
                ? { name }
                : { name, password: this.addChannelForm.password };
            try {
                const response = await fetch(`${API_BASE}/api/channels`, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-api-token': token,
                    },
                    body: JSON.stringify(body),
                });

                if (response.status === 401) {
                    this.handleUnauthorized();
                    return;
                }

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    this.addChannelError = errData.message || 'Failed to add channel';
                    return;
                }

                const data = await response.json();
                this.channels = data.channels || [];
                this.showAddChannelModal = false;
                this.addChannelForm = { name: '', password: '' };

                // Switch to the newly added channel
                const added = this.channels.find(c => c.name === name);
                if (added) {
                    this.selectChannel(added.index, added.name);
                }
            } catch (err) {
                console.error('addChannel failed:', err);
                this.addChannelError = 'Network error, please try again';
            } finally {
                this.addChannelLoading = false;
            }
        },

        confirmDeleteChannel() {
            this.deleteChannelTarget = this.selectedChannel;
            this.softDeleteChannel = false;
            this.showDeleteChannelModal = true;
        },

        async deleteChannel() {
            if (!this.deleteChannelTarget) return;
            this.deleteChannelLoading = true;
            const token = localStorage.getItem('api_token');
            try {
                const response = await fetch(`${API_BASE}/api/channels`, {
                    method: 'DELETE',
                    headers: {
                        'content-type': 'application/json',
                        'x-api-token': token,
                    },
                    body: JSON.stringify({ name: this.deleteChannelTarget, soft: this.softDeleteChannel }),
                });

                if (response.status === 401) {
                    this.handleUnauthorized();
                    return;
                }

                if (!response.ok) throw new Error('Failed to delete channel');

                const data = await response.json();
                this.channels = data.channels || [];
                this.showDeleteChannelModal = false;
                this.deleteChannelTarget = null;
                this.softDeleteChannel = false;

                // Switch to first channel
                if (this.channels.length > 0) {
                    const first = this.channels[0];
                    this.selectChannel(first.index, first.name);
                    window.location.hash = `channel-${first.index}`;
                }
            } catch (err) {
                console.error('deleteChannel failed:', err);
            } finally {
                this.deleteChannelLoading = false;
            }
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

        onLinksScroll(e) {
            // No-op for now, can be extended if needed
        },

        formatTime(ts) {
            const normalised = (ts && !/[Zz]$/.test(ts) && !/[+-]\d{2}:?\d{2}$/.test(ts))
                ? ts.replace(' ', 'T') + 'Z'
                : ts;
            const date = new Date(normalised);
            const timeStr = date.toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            const currentYear = now.getFullYear();
            const msgYear = date.getFullYear();
            const day = date.getDate().toString();
            const monthAbbr = date.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
            if (today.getTime() === msgDate.getTime()) {
                return timeStr;
            } else if (msgYear === currentYear) {
                return `${timeStr}, ${day}.${monthAbbr}`;
            } else {
                return `${timeStr}, ${day}.${monthAbbr}.${msgYear}`;
            }
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

        extractICloudUrls(text) {
            const matches = text.match(/https:\/\/share\.icloud\.com\/photos\/([A-Za-z0-9_-]{10,})/g);
            return matches || [];
        },

        _icloudShortGuid(url) {
            const m = url.match(/https:\/\/share\.icloud\.com\/photos\/([A-Za-z0-9_-]{10,})/);
            return m ? m[1] : null;
        },

        async _resolveICloudUrl(shortGuid) {
            // Return cached result (null = failed, string = blob URL)
            if (shortGuid in this.icloudImageCache) return this.icloudImageCache[shortGuid];

            // Mark as in-flight with a sentinel so concurrent calls don't double-fetch
            this.icloudImageCache = { ...this.icloudImageCache, [shortGuid]: undefined };

            try {
                const resp = await fetch(
                    'https://ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/public/records/resolve',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ shortGUIDs: [{ value: shortGuid }] }),
                    }
                );
                if (!resp.ok) throw new Error('CloudKit resolve failed');
                const json = await resp.json();
                const result = json.results && json.results[0];
                const downloadURL = result &&
                    result.rootRecord &&
                    result.rootRecord.fields &&
                    result.rootRecord.fields.previewData &&
                    result.rootRecord.fields.previewData.value &&
                    result.rootRecord.fields.previewData.value.downloadURL;
                if (!downloadURL) throw new Error('No downloadURL in response');

                // Fetch the binary — iCloud prepends a 4-byte header before the JPEG
                const imgResp = await fetch(downloadURL);
                if (!imgResp.ok) throw new Error('Image fetch failed');
                const buffer = await imgResp.arrayBuffer();
                // Strip the 4-byte iCloud header; JPEG magic (ff d8) starts at byte 4
                const jpeg = buffer.slice(4);
                const blob = new Blob([jpeg], { type: 'image/jpeg' });
                const blobUrl = URL.createObjectURL(blob);
                this.icloudImageCache = { ...this.icloudImageCache, [shortGuid]: blobUrl };
                return blobUrl;
            } catch (e) {
                console.warn('iCloud image resolve failed for', shortGuid, e);
                this.icloudImageCache = { ...this.icloudImageCache, [shortGuid]: null };
                return null;
            }
        },

        _resolveICloudUrlsInText(text) {
            const urls = this.extractICloudUrls(text);
            for (const url of urls) {
                const guid = this._icloudShortGuid(url);
                if (guid && !(guid in this.icloudImageCache)) {
                    this._resolveICloudUrl(guid);
                }
            }
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
            this.lastMessageTimestamp = null;
            this.messagesLoaded = false;
            this._hiddenUnread = 0;
            document.title = this._originalTitle;
            window.location.hash = '';
        },

        getAvatarChar(name) {
            const emojiRegex = /\p{Emoji}/gu;
            const matches = name.match(emojiRegex);
            if (matches && matches.length > 0) {
                return matches[matches.length - 1];
            }
            return name.charAt(0).toUpperCase();
        }
    };
}
