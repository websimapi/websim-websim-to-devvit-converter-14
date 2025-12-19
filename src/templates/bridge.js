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

    // Realtime -> Reddit Realtime
    this.messageHandlers.set('realtime:join', this.handleRealtimeJoin.bind(this));
    this.messageHandlers.set('realtime:send', this.handleRealtimeSend.bind(this));
    this.messageHandlers.set('realtime:updatePresence', this.handleUpdatePresence.bind(this));
    this.messageHandlers.set('realtime:updateRoomState', this.handleUpdateRoomState.bind(this));

    // User Identity -> Reddit User API
    this.messageHandlers.set('user:getInfo', this.handleGetUserInfo.bind(this));
    this.messageHandlers.set('user:getAvatar', this.handleGetAvatar.bind(this));
    this.messageHandlers.set('user:getCurrent', this.handleGetCurrentUser.bind(this));
  }

  async handleMessage(type: string, data: any): Promise<any> {
    const handler = this.messageHandlers.get(type);
    if (!handler) {
      throw new Error(\`Unknown message type: \${type}\`);
    }
    return await handler(data);
  }

  // REDIS HANDLERS
  private async handleRedisHGetAll(data: { key: string }) {
    try {
      const result = await this.context.redis.hGetAll(data.key);
      return { success: true, data: result || {} };
    } catch (error: any) {
      console.error('[Redis] hGetAll error:', error);
      return { success: false, error: error.message };
    }
  }

  private async handleRedisHSet(data: { key: string, fields: Record<string, string> }) {
    try {
      await this.context.redis.hSet(data.key, data.fields);
      return { success: true };
    } catch (error: any) {
      console.error('[Redis] hSet error:', error);
      return { success: false, error: error.message };
    }
  }

  private async handleRedisHDel(data: { key: string, fields: string[] }) {
    try {
      await this.context.redis.hDel(data.key, data.fields);
      return { success: true };
    } catch (error: any) {
      console.error('[Redis] hDel error:', error);
      return { success: false, error: error.message };
    }
  }

  private async handleRedisGet(data: { key: string }) {
    try {
      const result = await this.context.redis.get(data.key);
      return { success: true, data: result };
    } catch (error: any) {
      console.error('[Redis] get error:', error);
      return { success: false, error: error.message };
    }
  }

  private async handleRedisSet(data: { key: string, value: string }) {
    try {
      await this.context.redis.set(data.key, data.value);
      return { success: true };
    } catch (error: any) {
      console.error('[Redis] set error:', error);
      return { success: false, error: error.message };
    }
  }

  private async handleRedisDel(data: { keys: string[] }) {
    try {
      await this.context.redis.del(data.keys);
      return { success: true };
    } catch (error: any) {
      console.error('[Redis] del error:', error);
      return { success: false, error: error.message };
    }
  }

  // REALTIME HANDLERS
  private async handleRealtimeJoin(data: { channelName: string }) {
    try {
      const channel = this.context.realtime.channel(data.channelName);
      await channel.subscribe();
      return { success: true, channelId: data.channelName };
    } catch (error: any) {
      console.error('[Realtime] join error:', error);
      return { success: false, error: error.message };
    }
  }

  private async handleRealtimeSend(data: { channelName: string, message: any }) {
    try {
      const channel = this.context.realtime.channel(data.channelName);
      await channel.send(data.message);
      return { success: true };
    } catch (error: any) {
      console.error('[Realtime] send error:', error);
      return { success: false, error: error.message };
    }
  }

  private async handleUpdatePresence(data: { channelName: string, presence: any }) {
    try {
      const channel = this.context.realtime.channel(data.channelName);
      const userId = this.context.userId || 'anonymous';
      const presenceKey = \`presence:\${data.channelName}:\${userId}\`;
      await this.context.redis.set(presenceKey, JSON.stringify(data.presence));
      await this.context.redis.expire(presenceKey, 30);
      await channel.send({ type: 'presence_update', userId, presence: data.presence });
      return { success: true };
    } catch (error: any) {
      console.error('[Realtime] updatePresence error:', error);
      return { success: false, error: error.message };
    }
  }

  private async handleUpdateRoomState(data: { channelName: string, state: any }) {
    try {
      const channel = this.context.realtime.channel(data.channelName);
      const stateKey = \`roomstate:\${data.channelName}\`;
      await this.context.redis.set(stateKey, JSON.stringify(data.state));
      await channel.send({ type: 'roomstate_update', state: data.state });
      return { success: true };
    } catch (error: any) {
      console.error('[Realtime] updateRoomState error:', error);
      return { success: false, error: error.message };
    }
  }

  // USER IDENTITY HANDLERS
  private async handleGetUserInfo(data: { userId?: string, username?: string }) {
    try {
      let user;
      if (data.userId) {
        user = await this.context.reddit.getUserById(data.userId);
      } else if (data.username) {
        user = await this.context.reddit.getUserByUsername(data.username);
      } else {
        user = await this.context.reddit.getCurrentUser();
      }
      
      if (!user) {
        return { success: false, error: 'User not found' };
      }
      
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
      console.error('[User] getInfo error:', error);
      return { success: false, error: error.message };
    }
  }

  private async handleGetAvatar(data: { username: string }) {
    try {
      const snoovatarUrl = await this.context.reddit.getSnoovatarUrl(data.username);
      return { success: true, data: snoovatarUrl || this.getDefaultAvatar() };
    } catch (error: any) {
      console.error('[User] getAvatar error:', error);
      return { success: false, error: error.message, data: this.getDefaultAvatar() };
    }
  }

  private async handleGetCurrentUser(_data: any) {
    try {
      const user = await this.context.reddit.getCurrentUser();
      if (!user) {
        return { 
          success: true, 
          data: { id: 'anonymous', username: 'Guest', avatarUrl: this.getDefaultAvatar(), isAnonymous: true } 
        };
      }
      const snoovatarUrl = await this.context.reddit.getSnoovatarUrl(user.username);
      return { 
        success: true, 
        data: { id: user.id, username: user.username, avatarUrl: snoovatarUrl || this.getDefaultAvatar(), isAnonymous: false } 
      };
    } catch (error: any) {
      console.error('[User] getCurrentUser error:', error);
      return { 
        success: false, 
        error: error.message, 
        data: { id: 'anonymous', username: 'Guest', avatarUrl: this.getDefaultAvatar(), isAnonymous: true } 
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
  console.log('[Devvit Bridge] Initializing WebSim compatibility layer...');

  const pending = new Map();
  const uuid = () => Math.random().toString(36).substr(2, 9);
  
  // Bridge Communication
  function bridgeCall(type, data) {
    return new Promise((resolve, reject) => {
      const messageId = uuid();
      pending.set(messageId, { resolve, reject });
      window.parent.postMessage({ type, data, messageId }, '*');
      setTimeout(() => {
        if (pending.has(messageId)) {
          pending.delete(messageId);
          reject(new Error('Timeout waiting for Devvit server (' + type + ')'));
        }
      }, 10000);
    });
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg) return;

    if (msg.type === 'devvit-response') {
      const { messageId, result, error } = msg.data;
      if (pending.has(messageId)) {
        const p = pending.get(messageId);
        pending.delete(messageId);
        if (error) p.reject(new Error(error));
        else p.resolve(result && result.data !== undefined ? result.data : result);
      }
    } else if (msg.type === 'devvit-realtime') {
      const payload = msg.data.message;
      if (window.room && window.room._onRealtime) {
        window.room._onRealtime(payload);
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
        // Simple polling for DB changes (Realtime is separate)
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
    }

    async initialize() {
      if(this.connected) return;
      this.connected = true;

      try {
        // 1. Join Realtime Channel
        await bridgeCall('realtime:join', { channelName: 'global' });

        // 2. Get User Identity
        const user = await bridgeCall('user:getCurrent', {});
        this.clientId = user.id;
        this.peers[this.clientId] = user;

        // 3. Announce Presence
        await this.updatePresence({});
        
        console.log('[Devvit Bridge] Connected as', user.username);
      } catch(e) {
        console.error('[Devvit Bridge] Initialization failed:', e);
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
    
    requestPresenceUpdate() { /* Not implemented in bridge yet */ }

    subscribePresence(cb) { return this._on('presence', cb); }
    subscribeRoomState(cb) { return this._on('roomState', cb); }
    
    send(msg) {
      bridgeCall('realtime:send', { channelName: 'global', message: { ...msg, senderId: this.clientId } });
    }
    
    _onRealtime(msg) {
      if (msg.type === 'presence_update') {
         const { userId, presence } = msg;
         this.presence[userId] = presence;
         
         // If peer unknown, try to fetch info or placeholder
         if (!this.peers[userId]) {
            this.peers[userId] = { id: userId, username: 'User', avatarUrl: '' }; // placeholder
            bridgeCall('user:getInfo', { userId }).then(u => {
                if(u) this.peers[userId] = u;
            }).catch(() => {});
         }
         
         this._emit('presence', this.presence);
      } else if (msg.type === 'roomstate_update') {
         this.roomState = msg.state;
         this._emit('roomState', this.roomState);
      } else {
         if (this.onmessage) this.onmessage({ data: msg });
      }
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
  
  // Helper for generating avatar URLs
  window.getUserAvatar = async (username) => {
     const res = await bridgeCall('user:getAvatar', { username });
     return res;
  };
  
  // Auto-init helper if game relies on 'room' variable being global but not instantiated
  // Some games do: const room = new WebsimSocket();
  // Others might expect it to exist? Usually not.
  
  console.log('[Devvit Bridge] WebSim compatibility layer ready!');
})();
`;

