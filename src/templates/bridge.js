export const getDevvitBridgeServerCode = () => `// src/devvit-bridge.ts
// Server-side bridge for WebSim → Devvit API translation
import type { Context } from '@devvit/public-api';

export class DevvitBridge {
  private context: Context;
  private messageHandlers: Map<string, Function> = new Map();

  constructor(context: Context) {
    this.context = context;
    this.setupHandlers();
  }

  private setupHandlers() {
    // Database Operations -> Redis
    this.messageHandlers.set('db:hGetAll', this.handleRedisHGetAll.bind(this));
    this.messageHandlers.set('db:hSet', this.handleRedisHSet.bind(this));
    this.messageHandlers.set('db:hDel', this.handleRedisHDel.bind(this));
    this.messageHandlers.set('db:get', this.handleRedisGet.bind(this));
    this.messageHandlers.set('db:set', this.handleRedisSet.bind(this));
    this.messageHandlers.set('db:del', this.handleRedisDel.bind(this));

    // Realtime -> Redis Polling (Devvit Blocks Compatible)
    this.messageHandlers.set('realtime:join', this.handleRealtimeJoin.bind(this));
    this.messageHandlers.set('realtime:send', this.handleRealtimeSend.bind(this));
    this.messageHandlers.set('realtime:sync', this.handleRealtimeSync.bind(this));
    this.messageHandlers.set('realtime:updatePresence', this.handleUpdatePresence.bind(this));
    this.messageHandlers.set('realtime:updateRoomState', this.handleUpdateRoomState.bind(this));

    // User Identity -> Reddit User API (Cached)
    this.messageHandlers.set('user:getInfo', this.handleGetUserInfo.bind(this));
    this.messageHandlers.set('user:getAvatar', this.handleGetAvatar.bind(this));
    this.messageHandlers.set('user:getCurrent', this.handleGetCurrentUser.bind(this));
    
    // Hotswap / Game State
    this.messageHandlers.set('game:saveState', this.handleSaveGameState.bind(this));
    this.messageHandlers.set('game:loadState', this.handleLoadGameState.bind(this));
  }

  async handleMessage(type: string, data: any, currentUser?: any): Promise<any> {
    // Optimization: If we have pre-fetched user info (L1 Cache), use it
    if (type === 'user:getCurrent' && currentUser) {
        console.log('[Bridge] Using L1 cached currentUser');
        return { success: true, data: currentUser };
    }

    // Handle legacy wrapped messages
    if (type === 'WEBSIM_SOCKET_MSG' && data && data.payload) {
        // Unwrap and recurse
        const map: Record<string, string> = {
            'join': 'realtime:join',
            'presence_update': 'realtime:updatePresence',
            'room_state_update': 'realtime:updateRoomState',
            'broadcast_event': 'realtime:send',
            'db_load': 'db:hGetAll', 
        };
        const targetType = map[data.payload.type];
        if (targetType) {
            let payload = data.payload.payload || {};
            if (data.payload.type === 'join') payload = { channelName: 'global' };
            if (data.payload.type === 'db_load') payload = { key: 'collection:' + payload.collection };
            return this.handleMessage(targetType, payload, currentUser);
        }
    }

    const handler = this.messageHandlers.get(type);
    if (!handler) {
      throw new Error(\`Unknown message type: \${type}\`);
    }
    return await handler(data);
  }

  // --- REDIS CACHE HELPERS ---
  private async getCache(key: string): Promise<any | null> {
      try {
          const val = await this.context.redis.get(key);
          return val ? JSON.parse(val) : null;
      } catch(e) { return null; }
  }

  private async setCache(key: string, val: any, ttl?: number) {
      try {
          await this.context.redis.set(key, JSON.stringify(val));
          if (ttl) await this.context.redis.expire(key, ttl);
      } catch(e) {}
  }

  // --- DB HANDLERS ---
  private async handleRedisHGetAll(data: { key: string }) {
    try {
      const result = await this.context.redis.hGetAll(data.key);
      return { success: true, data: result || {} };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async handleRedisHSet(data: { key: string, fields: Record<string, string> }) {
    try {
      await this.context.redis.hSet(data.key, data.fields);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async handleRedisHDel(data: { key: string, fields: string[] }) {
    try {
      await this.context.redis.hDel(data.key, data.fields);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async handleRedisGet(data: { key: string }) {
    try {
      const result = await this.context.redis.get(data.key);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async handleRedisSet(data: { key: string, value: string }) {
    try {
      await this.context.redis.set(data.key, data.value);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async handleRedisDel(data: { keys: string[] }) {
    try {
      await this.context.redis.del(data.keys);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // --- GAME STATE HANDLERS (Hotswap Support) ---
  private async handleSaveGameState(data: { key: string, state: any }) {
      try {
          const userId = this.context.userId || 'anon';
          const fullKey = \`gamestate:\${data.key}:\${userId}\`;
          await this.context.redis.set(fullKey, JSON.stringify(data.state));
          return { success: true };
      } catch(e: any) {
          return { success: false, error: e.message };
      }
  }

  private async handleLoadGameState(data: { key: string }) {
      try {
          const userId = this.context.userId || 'anon';
          const fullKey = \`gamestate:\${data.key}:\${userId}\`;
          const val = await this.context.redis.get(fullKey);
          return { success: true, data: val ? JSON.parse(val) : null };
      } catch(e: any) {
          return { success: false, error: e.message };
      }
  }

  // --- REALTIME HANDLERS ---
  private async handleRealtimeJoin(data: { channelName: string }) {
    return { success: true, channelId: data.channelName || 'global' };
  }

  private async handleRealtimeSend(data: { channelName: string, message: any }) {
    try {
      const msgsKey = \`messages:\${data.channelName}\`;
      const score = Date.now();
      const member = JSON.stringify({ ...data.message, timestamp: score });
      await this.context.redis.zAdd(msgsKey, { member, score });
      await this.context.redis.zRemRangeByScore(msgsKey, 0, score - 60000);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async handleRealtimeSync(data: { channelName: string, since: number }) {
    try {
      const now = Date.now();
      const channel = data.channelName;
      
      // Cleanup
      const heartbeatKey = \`heartbeat:\${channel}\`;
      const presenceKey = \`presence:\${channel}\`;
      const deadUsers = await this.context.redis.zRangeByScore(heartbeatKey, 0, now - 30000);
      if (deadUsers && deadUsers.length > 0) {
          const members = deadUsers.map(u => u.member);
          await this.context.redis.zRem(heartbeatKey, members);
          await this.context.redis.hDel(presenceKey, members);
      }
      
      // Messages
      const msgsKey = \`messages:\${channel}\`;
      const messagesRaw = await this.context.redis.zRangeByScore(msgsKey, data.since + 1, Infinity);
      const messages = messagesRaw.map(m => {
          try { return JSON.parse(m.member); } catch(e) { return null; }
      }).filter(Boolean);
      
      // Presence
      const presence = await this.context.redis.hGetAll(presenceKey);
      
      // Room State
      const roomStateStr = await this.context.redis.get(\`roomstate:\${channel}\`);
      const roomState = roomStateStr ? JSON.parse(roomStateStr) : {};
      
      return { success: true, messages, presence, roomState, timestamp: now };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async handleUpdatePresence(data: { channelName: string, presence: any }) {
    try {
      const userId = this.context.userId || 'anonymous';
      const presenceKey = \`presence:\${data.channelName}\`;
      const heartbeatKey = \`heartbeat:\${data.channelName}\`;
      await this.context.redis.hSet(presenceKey, { [userId]: JSON.stringify(data.presence) });
      await this.context.redis.zAdd(heartbeatKey, { member: userId, score: Date.now() });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async handleUpdateRoomState(data: { channelName: string, state: any }) {
    try {
      const stateKey = \`roomstate:\${data.channelName}\`;
      await this.context.redis.set(stateKey, JSON.stringify(data.state));
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // --- USER HANDLERS (WITH REDIS CACHE) ---
  private async handleGetUserInfo(data: { userId?: string, username?: string }) {
    try {
      if (!data.userId && !data.username) return this.handleGetCurrentUser({});

      let user;
      if (data.userId) {
        user = await this.context.reddit.getUserById(data.userId);
      } else if (data.username) {
        user = await this.context.reddit.getUserByUsername(data.username);
      }
      
      if (!user) return { success: false, error: 'User not found' };
      
      const snoovatarUrl = await this.context.reddit.getSnoovatarUrl(user.username);
      return { 
        success: true, 
        data: { 
          id: user.id, 
          username: user.username, 
          avatarUrl: snoovatarUrl || this.getDefaultAvatar(),
          createdAt: user.createdAt 
        } 
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async handleGetAvatar(data: { username: string }) {
    try {
      const snoovatarUrl = await this.context.reddit.getSnoovatarUrl(data.username);
      return { success: true, data: snoovatarUrl || this.getDefaultAvatar() };
    } catch (error: any) {
      return { success: false, error: error.message, data: this.getDefaultAvatar() };
    }
  }

  private async handleGetCurrentUser(_data: any) {
    const userId = this.context.userId;
    if (!userId) {
        // Not logged in
        return { 
          success: true, 
          data: { id: 'guest', username: 'Guest', avatarUrl: this.getDefaultAvatar(), isAnonymous: true } 
        };
    }

    // 1. Check Redis Cache
    const cacheKey = \`user_cache:\${userId}\`;
    const cached = await this.getCache(cacheKey);
    if (cached) {
        console.log('[Bridge] Redis Cache Hit for user', userId);
        return { success: true, data: cached };
    }

    // 2. Fetch from API
    try {
      console.log('[Bridge] Fetching user info from Reddit API...');
      const user = await this.context.reddit.getCurrentUser();
      
      if (!user) throw new Error('No user returned');

      let snoovatarUrl = '';
      try {
         snoovatarUrl = await this.context.reddit.getSnoovatarUrl(user.username) || '';
      } catch(e) {}

      const userData = { 
          id: user.id, 
          username: user.username, 
          avatarUrl: snoovatarUrl || this.getDefaultAvatar(), 
          isAnonymous: false 
      };

      // 3. Save to Redis (TTL 60s)
      await this.setCache(cacheKey, userData, 60);
      
      return { success: true, data: userData };

    } catch (error: any) {
      console.warn('[Bridge] User fetch failed, returning Guest fallback:', error.message);
      return { 
        success: true, 
        data: { id: 'guest_' + userId.substr(0,5), username: 'Guest', avatarUrl: this.getDefaultAvatar(), isAnonymous: true } 
      };
    }
  }

  private getDefaultAvatar(): string {
    return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%233b82f6"/%3E%3Ctext x="50" y="50" text-anchor="middle" dy=".3em" fill="white" font-size="40" font-family="Arial"%3E?%3C/text%3E%3C/svg%3E';
  }
}
`;

export const websimToDevvitPolyfill = `
(function() {
  console.log('[Devvit Bridge] Initializing WebSim compatibility layer (Blocks Mode)...');

  const pending = new Map();
  const uuid = () => Math.random().toString(36).substr(2, 9);
  
  // Bridge Communication
  function bridgeCall(type, data) {
    return new Promise((resolve, reject) => {
      const messageId = uuid();
      pending.set(messageId, { resolve, reject });
      
      console.log('[Devvit Bridge] Sending:', type, messageId);

      // Send to parent
      try {
          window.parent.postMessage({ type, data, messageId }, '*');
      } catch(e) {
          pending.delete(messageId);
          reject(new Error('Failed to postMessage: ' + e.message));
      }
      
      // Increased timeout to 30s for slow server/network ops
      setTimeout(() => {
        if (pending.has(messageId)) {
          pending.delete(messageId);
          console.warn('[Devvit Bridge] Timeout on ' + type + ' (' + messageId + ')');
          reject(new Error('Timeout waiting for Devvit server (' + type + ')'));
        }
      }, 30000);
    });
  }

  window.addEventListener('message', (e) => {
    // Robust handling: e.data might be the payload or wrapped
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;

    // Check for standard bridge response
    if (msg.type === 'devvit-response' && msg.data) {
      const { messageId, result, error } = msg.data;
      
      // Debug logging
      // console.log('[Devvit Bridge Client] Received response', messageId);

      if (pending.has(messageId)) {
        const p = pending.get(messageId);
        pending.delete(messageId);
        if (error) {
            console.error('[Devvit Bridge] Server Error:', error);
            p.reject(new Error(error));
        } else {
            p.resolve(result && result.data !== undefined ? result.data : result);
        }
      } else {
        // If we received a response for a message ID not in pending, it might have timed out
        // or it's a duplicate. We ignore it.
      }
    }
  });

  // WebsimCollection Polyfill
  class WebsimCollection {
    constructor(name, room) {
      this.name = name;
      this.room = room;
      this.subs = [];
      this.polling = false;
    }

    async create(data) {
      const id = data.id || uuid();
      const record = { ...data, id, created_at: new Date().toISOString() };
      await bridgeCall('db:hSet', { 
        key: 'collection:' + this.name, 
        fields: { [id]: JSON.stringify(record) } 
      });
      return record;
    }

    async getList() {
      const res = await bridgeCall('db:hGetAll', { key: 'collection:' + this.name });
      const records = Object.values(res).map(s => {
          try { return JSON.parse(s); } catch(e) { return null; }
      }).filter(Boolean);
      return records.sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }

    subscribe(cb) {
      this.subs.push(cb);
      this.getList().then(cb).catch(console.error);
      
      if (!this.polling) {
        this.polling = true;
        // Simple polling for DB changes
        setInterval(async () => {
           if(this.subs.length === 0) return;
           try {
             const list = await this.getList();
             this.subs.forEach(fn => fn(list));
           } catch(e) {}
        }, 2000);
      }
      return () => { this.subs = this.subs.filter(s => s !== cb); };
    }
  }

  // WebsimSocket Polyfill
  class WebsimSocket {
    constructor() {
      this.peers = {};
      this.roomState = {};
      this.presence = {};
      this.clientId = 'init'; 
      this.collections = {};
      this.listeners = {};
      this.connected = false;
      this.lastSync = 0;
      this.pollInterval = null;
    }

    async initialize() {
      if(this.connected) return;
      this.connected = true;

      try {
        // 1. "Join" (Ack)
        await bridgeCall('realtime:join', { channelName: 'global' });

        // 2. Get User Identity
        const user = await bridgeCall('user:getCurrent', {});
        this.clientId = user.id;
        this.peers[this.clientId] = user;

        // 3. Announce Presence
        await this.updatePresence({});
        
        console.log('[Devvit Bridge] Connected as', user.username);
        
        // 4. Start Polling Loop (The "Realtime" engine for Blocks)
        this.startPolling();

      } catch(e) {
        console.error('[Devvit Bridge] Initialization failed:', e);
      }
    }
    
    startPolling() {
      if (this.pollInterval) clearInterval(this.pollInterval);
      this.pollInterval = setInterval(async () => {
          try {
              const data = await bridgeCall('realtime:sync', { 
                  channelName: 'global',
                  since: this.lastSync 
              });
              
              if (data.success) {
                  this.handleSync(data);
              }
          } catch(e) {
              console.warn('[Polling] Sync failed', e);
          }
      }, 1000); // 1s polling
    }
    
    handleSync(data) {
        // Update Timestamp
        if (data.timestamp) this.lastSync = data.timestamp;
        
        // 1. Process Messages
        if (data.messages && data.messages.length > 0) {
            data.messages.forEach(msg => {
                if (msg.senderId === this.clientId) return; // Ignore self-echo
                this._handleIncomingMessage(msg);
            });
        }
        
        // 2. Process Presence
        if (data.presence) {
            const newPresence = {};
            Object.entries(data.presence).forEach(([uid, jsonStr]) => {
                try {
                    newPresence[uid] = JSON.parse(jsonStr);
                    // Fetch user info if new peer
                    if (!this.peers[uid]) {
                         this.peers[uid] = { id: uid, username: 'User', avatarUrl: '' };
                         bridgeCall('user:getInfo', { userId: uid }).then(u => {
                            if(u && u.data) this.peers[uid] = u.data;
                         });
                    }
                } catch(e) {}
            });
            
            // Detect changes? For now just replace
            this.presence = newPresence;
            this._emit('presence', this.presence);
        }
        
        // 3. Process Room State
        if (data.roomState) {
            this.roomState = data.roomState;
            this._emit('roomState', this.roomState);
        }
    }
    
    _handleIncomingMessage(msg) {
        if (msg.type === 'presence_update') {
            // Handled by sync presence logic usually, but keep for compat
        } else if (msg.type === 'roomstate_update') {
            // Handled by sync roomstate
        } else {
            // Custom event
            if (this.onmessage) {
                this.onmessage({ 
                    data: { 
                        ...msg, 
                        clientId: msg.senderId,
                        username: this.peers[msg.senderId]?.username || 'User'
                    } 
                });
            }
        }
    }

    collection(name) {
      if (!this.collections[name]) this.collections[name] = new WebsimCollection(name, this);
      return this.collections[name];
    }

    async updatePresence(data) {
      this.presence[this.clientId] = { ...this.presence[this.clientId], ...data };
      this._emit('presence', this.presence);
      await bridgeCall('realtime:updatePresence', { channelName: 'global', presence: this.presence[this.clientId] });
    }

    async updateRoomState(data) {
      this.roomState = { ...this.roomState, ...data };
      this._emit('roomState', this.roomState);
      await bridgeCall('realtime:updateRoomState', { channelName: 'global', state: this.roomState });
    }
    
    requestPresenceUpdate() {}

    subscribePresence(cb) { return this._on('presence', cb); }
    subscribeRoomState(cb) { return this._on('roomState', cb); }
    
    send(msg) {
      // Optimistic local echo? No, usually not for broadcast
      bridgeCall('realtime:send', { channelName: 'global', message: { ...msg, senderId: this.clientId } });
    }

    _on(evt, cb) {
      if (!this.listeners[evt]) this.listeners[evt] = [];
      this.listeners[evt].push(cb);
      if (evt === 'presence') cb(this.presence);
      if (evt === 'roomState') cb(this.roomState);
      return () => { this.listeners[evt] = this.listeners[evt].filter(f => f !== cb); };
    }

    _emit(evt, data) {
      (this.listeners[evt] || []).forEach(cb => {
         try { cb(data); } catch(e) { console.error(e); }
      });
    }
  }

  // Assign Globals
  window.WebsimSocket = WebsimSocket;
  
  // Polyfill window.websim
  window.websim = {
    getCurrentUser: () => bridgeCall('user:getCurrent', {}),
    getProject: async () => ({ id: 'devvit-project', title: 'Devvit Game' }),
    upload: async (blob) => URL.createObjectURL(blob)
  };
  
  window.getUserAvatar = async (username) => {
     const res = await bridgeCall('user:getAvatar', { username });
     return res;
  };
  
  console.log('[Devvit Bridge] WebSim compatibility layer ready!');
})();
`;

