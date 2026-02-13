const API_BASE = 'http://127.0.0.1:8000';

function app() {
    return {
        view: 'login',
        loading: false,
        error: null,
        credentials: {
            email: '',
            password: ''
        },
        user: {
            email: '',
            username: ''
        },
        channels: [],
        map: null,

        async init() {
            const token = localStorage.getItem('api_token');
            const userData = localStorage.getItem('user');
            
            if (token && userData) {
                this.user = JSON.parse(userData);
                const valid = await this.verifyToken();
                if (valid) {
                    this.view = 'dashboard';
                    this.$nextTick(() => this.initMap());
                } else {
                    this.clearSession();
                }
            }
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
                    username: data.username
                }));

                this.user = { email: data.email, username: data.username };
                this.credentials = { email: '', password: '' };
                this.view = 'dashboard';
                
                await this.fetchChannels();
                this.$nextTick(() => this.initMap());
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
                await this.fetchChannels();
                return true;
            } catch {
                return false;
            }
        },

        async fetchChannels() {
            const token = localStorage.getItem('api_token');
            const response = await fetch(`${API_BASE}/api/channels`, {
                headers: { 'x-api-token': token }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch channels');
            }

            const data = await response.json();
            this.channels = data.channels || [];
        },

        logout() {
            this.clearSession();
            this.view = 'login';
            if (this.map) {
                this.map.remove();
                this.map = null;
            }
        },

        clearSession() {
            localStorage.removeItem('api_token');
            localStorage.removeItem('user');
            this.user = { email: '', username: '' };
            this.channels = [];
        },

        initMap() {
            if (this.map) return;
            
            this.map = L.map('map').setView([51.505, -0.09], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(this.map);
        }
    };
}
