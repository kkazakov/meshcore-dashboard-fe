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
        selectedChannel: 'Public',
        messages: [],
        messagesLoading: false,
        newMessage: '',
        sending: false,
        darkMode: false,

        async init() {
            this.loadTheme();
            
            const token = localStorage.getItem('api_token');
            const userData = localStorage.getItem('user');
            
            if (token && userData) {
                this.user = JSON.parse(userData);
                const valid = await this.verifyToken();
                if (valid) {
                    this.view = 'dashboard';
                    await this.fetchMessages();
                } else {
                    this.clearSession();
                }
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

        toggleTheme() {
            this.darkMode = !this.darkMode;
            localStorage.setItem('darkMode', this.darkMode);
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
                await this.fetchMessages();
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

        async fetchMessages() {
            this.messagesLoading = true;
            const token = localStorage.getItem('api_token');
            
            try {
                const response = await fetch(
                    `${API_BASE}/api/messages?channel=${encodeURIComponent(this.selectedChannel)}&from=0&limit=100&order=asc`,
                    { headers: { 'x-api-token': token } }
                );

                if (!response.ok) {
                    throw new Error('Failed to fetch messages');
                }

                const data = await response.json();
                this.messages = data.messages || [];
                this.$nextTick(() => this.scrollToBottom());
            } catch (err) {
                console.error(err);
            } finally {
                this.messagesLoading = false;
            }
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

                if (!response.ok) {
                    throw new Error('Failed to send message');
                }

                this.newMessage = '';
                await this.fetchMessages();
            } catch (err) {
                console.error(err);
            } finally {
                this.sending = false;
            }
        },

        selectChannel(channelName) {
            this.selectedChannel = channelName;
            this.messages = [];
            this.fetchMessages();
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

        logout() {
            this.clearSession();
            this.view = 'login';
        },

        clearSession() {
            localStorage.removeItem('api_token');
            localStorage.removeItem('user');
            this.user = { email: '', username: '' };
            this.channels = [];
            this.messages = [];
        }
    };
}
