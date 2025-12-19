export const getDevvitBridgeServerCode = () => ``; // No longer used

export const websimToDevvitPolyfill = `
(function() {
  console.log('[Devvit Client] Initializing...');

  const pending = new Map();
  const generateId = () => Math.random().toString(36).substr(2, 9);
  
  // --- 1. CORE BRIDGE (Devvit Client) ---

  function bridgeCall(type, data) {
    return new Promise((resolve, reject) => {
      const messageId = generateId();
      pending.set(messageId, { resolve, reject });
      
      // Send to parent (Devvit main.tsx)
      window.parent.postMessage({ 
        type: 'devvit-request',
        messageId, 
        action: type, 
        payload: data 
      }, '*');
      
      // Timeout
      setTimeout(() => {
        if (pending.has(messageId)) {
          pending.delete(messageId);
          reject(new Error('Timeout: ' + type));
        }
      }, 10000);
    });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    
    if (msg && msg.type === 'devvit-response') {
      const { messageId, result, error } = msg;
      
      if (pending.has(messageId)) {
        const { resolve, reject } = pending.get(messageId);
        pending.delete(messageId);
        
        if (error) {
          reject(new Error(error));
        } else {
          resolve(result);
        }
      }
    }
  });

  // Expose Modern API
  window.DevvitAPI = {
    // User
    getCurrentUser: () => bridgeCall('user:getCurrent', {}),
    getUser: (username) => bridgeCall('user:getByUsername', { username }),
    
    // DB
    dbSet: (key, value) => bridgeCall('db:set', { key, value }),
    dbGet: (key) => bridgeCall('db:get', { key }),
    dbHSet: (key, fields) => bridgeCall('db:hSet', { key, fields }),
    dbHGetAll: (key) => bridgeCall('db:hGetAll', { key }),
    
    // Realtime
    sendMessage: (channel, message) => bridgeCall('realtime:send', { channel, message }),
    getMessages: (channel, since) => bridgeCall('realtime:getMessages', { channel, since }),
    
    // Game
    saveGameState: (state) => bridgeCall('game:save', { state }),
    loadGameState: () => bridgeCall('game:load', {})
  };

  // --- 2. WEBSIM COMPATIBILITY ADAPTER ---
  // Maps old "WebsimSocket" calls to new DevvitAPI calls
  
  class WebsimCollection {
      constructor(name) { this.name = name; this.subs = []; }
      async create(data) {
          const id = data.id || generateId();
          const record = { ...data, id, created_at: new Date().toISOString() };
          await window.DevvitAPI.dbHSet('collection:' + this.name, { [id]: JSON.stringify(record) });
          return record;
      }
      async getList() {
          const res = await window.DevvitAPI.dbHGetAll('collection:' + this.name);
          const list = Object.values(res).map(s => { try { return JSON.parse(s); } catch(e){ return null; }}).filter(Boolean);
          return list.sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));
      }
      subscribe(cb) {
          this.subs.push(cb);
          this.getList().then(cb).catch(console.error);
          // Poll
          const int = setInterval(async () => {
             if(this.subs.length === 0) { clearInterval(int); return; }
             try { const l = await this.getList(); this.subs.forEach(f => f(l)); } catch(e){}
          }, 2000);
          return () => { this.subs = this.subs.filter(s => s !== cb); };
      }
  }

  class WebsimSocket {
      constructor() {
          this.peers = {};
          this.roomState = {};
          this.presence = {};
          this.clientId = 'guest';
          this.listeners = {};
          this.collections = {};
          this.lastMsg = Date.now();
      }
      
      collection(name) {
          if(!this.collections[name]) this.collections[name] = new WebsimCollection(name);
          return this.collections[name];
      }
      
      async initialize() {
          try {
              const u = await window.DevvitAPI.getCurrentUser();
              this.clientId = u.id;
              this.peers[this.clientId] = u;
              console.log('[Adapter] Initialized as', u.username);
              
              // Start Polling Loop for messages
              setInterval(() => this.pollMessages(), 1500);
          } catch(e) { console.error('Init failed', e); }
      }
      
      async pollMessages() {
          try {
             const msgs = await window.DevvitAPI.getMessages('global', this.lastMsg);
             if(msgs && msgs.length > 0) {
                 msgs.forEach(m => {
                     this.lastMsg = Math.max(this.lastMsg, m.timestamp);
                     if (m.senderId === this.clientId) return; // ignore self
                     if (this.onmessage) this.onmessage({ data: { ...m, clientId: m.senderId } });
                 });
             }
          } catch(e) {}
      }
      
      send(msg) {
          window.DevvitAPI.sendMessage('global', { ...msg, senderId: this.clientId });
      }
      
      // Simplistic mapping for presence/roomState
      async updatePresence(data) {
          console.log('[Adapter] updatePresence called (not fully supported in simple mode)');
      }
      async updateRoomState(data) {
          this.roomState = { ...this.roomState, ...data };
          await window.DevvitAPI.dbSet('roomstate:global', this.roomState);
          this._emit('roomState', this.roomState);
      }
      
      subscribePresence(cb) { /* Stub */ }
      subscribeRoomState(cb) { 
          // Initial fetch
          window.DevvitAPI.dbGet('roomstate:global').then(s => {
              if(s) { this.roomState = s; cb(s); }
          });
          return this._on('roomState', cb); 
      }
      
      _on(e, cb) {
          if(!this.listeners[e]) this.listeners[e] = [];
          this.listeners[e].push(cb);
          return () => { this.listeners[e] = this.listeners[e].filter(x => x !== cb); };
      }
      _emit(e, d) { (this.listeners[e]||[]).forEach(c => c(d)); }
  }

  window.WebsimSocket = WebsimSocket;
  window.websim = {
      getCurrentUser: window.DevvitAPI.getCurrentUser,
      getProject: async () => ({ id: 'devvit-game', title: 'Game' }),
      upload: async (b) => URL.createObjectURL(b)
  };
  window.getUserAvatar = async (username) => {
      try { return (await window.DevvitAPI.getUser(username)).avatarUrl; } catch(e) { return ''; }
  };

  console.log('[Devvit Client] Ready!');
})();
`;

