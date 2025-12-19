export const getMainTsx = (title, webviewPath) => `/** @jsx Devvit.createElement */
/** @jsxFrag Devvit.Fragment */

import { Devvit } from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
  redis: true,
  // Realtime is simulated via Redis polling in Blocks
});

Devvit.addCustomPostType({
  name: '${title.replace(/'/g, "\\'")}',
  height: 'tall',
  render: (context) => {
    
    // Handle ALL messages from webview here
    const onMessage = async (event: any) => {
      const msg = event; // In Devvit 0.11+, event IS the payload
      
      if (!msg || !msg.type || msg.type !== 'devvit-request') {
          // Pass through console logs if they come in standard format
          if (msg && msg.type === 'console') {
              console.log('[Web]', ...(msg.args || []));
          }
          return;
      }
      
      const { messageId, action, payload } = msg;
      
      console.log(\`[Server] Handling: \${action}\`);
      
      try {
        let result: any;
        
        // === USER IDENTITY ===
        if (action === 'user:getCurrent') {
          const user = await context.reddit.getCurrentUser();
          if (user) {
            const avatar = await context.reddit.getSnoovatarUrl(user.username);
            result = {
              id: user.id,
              username: user.username,
              avatarUrl: avatar || getDefaultAvatar(),
              isAnonymous: false
            };
          } else {
            result = {
              id: 'guest',
              username: 'Guest',
              avatarUrl: getDefaultAvatar(),
              isAnonymous: true
            };
          }
        }
        
        else if (action === 'user:getByUsername') {
          const user = await context.reddit.getUserByUsername(payload.username);
          if (user) {
            const avatar = await context.reddit.getSnoovatarUrl(user.username);
            result = {
              id: user.id,
              username: user.username,
              avatarUrl: avatar || getDefaultAvatar()
            };
          } else {
            throw new Error('User not found');
          }
        }
        
        // === REDIS DATABASE ===
        else if (action === 'db:set') {
          await context.redis.set(payload.key, JSON.stringify(payload.value));
          result = { success: true };
        }
        
        else if (action === 'db:get') {
          const value = await context.redis.get(payload.key);
          result = value ? JSON.parse(value) : null;
        }
        
        else if (action === 'db:hSet') {
          await context.redis.hSet(payload.key, payload.fields);
          result = { success: true };
        }
        
        else if (action === 'db:hGetAll') {
          const data = await context.redis.hGetAll(payload.key);
          result = data || {};
        }
        
        // === GAME STATE (per user) ===
        else if (action === 'game:save') {
          const userId = context.userId || 'guest';
          await context.redis.set(\`gamestate:\${userId}\`, JSON.stringify(payload.state));
          result = { success: true };
        }
        
        else if (action === 'game:load') {
          const userId = context.userId || 'guest';
          const stateStr = await context.redis.get(\`gamestate:\${userId}\`);
          result = stateStr ? JSON.parse(stateStr) : null;
        }
        
        // === "REALTIME" (Redis-based) ===
        else if (action === 'realtime:send') {
          const channel = payload.channel || 'global';
          const messagesKey = \`messages:\${channel}\`;
          const timestamp = Date.now();
          
          // Store message with score = timestamp
          await context.redis.zAdd(messagesKey, {
            member: JSON.stringify({ ...payload.message, timestamp }),
            score: timestamp
          });
          
          // Keep only last 100 messages
          const count = await context.redis.zCard(messagesKey);
          if (count > 100) {
            await context.redis.zRemRangeByRank(messagesKey, 0, count - 101);
          }
          
          result = { success: true };
        }
        
        else if (action === 'realtime:getMessages') {
          const channel = payload.channel || 'global';
          const since = payload.since || 0;
          const messagesKey = \`messages:\${channel}\`;
          
          // Get messages since timestamp
          const messages = await context.redis.zRangeByScore(messagesKey, since + 1, Infinity);
          
          result = messages.map(m => {
            try { return JSON.parse(m.member); }
            catch(e) { return null; }
          }).filter(Boolean);
        }
        
        else {
          throw new Error(\`Unknown action: \${action}\`);
        }
        
        // Send response back
        await context.ui.webView.postMessage('game-webview', {
          type: 'devvit-response',
          messageId,
          result
        });
        
      } catch (error: any) {
        console.error(\`[Server] Error in \${action}:\`, error);
        
        await context.ui.webView.postMessage('game-webview', {
          type: 'devvit-response',
          messageId,
          error: error.message || 'Unknown error'
        });
      }
    };

    return (
      <vstack height="100%" width="100%">
        <webview
          id="game-webview"
          url="${webviewPath}"
          onMessage={onMessage}
          height="100%"
          width="100%"
        />
      </vstack>
    );
  },
});

function getDefaultAvatar(): string {
  return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%233b82f6"/%3E%3Ctext x="50" y="50" text-anchor="middle" dy=".3em" fill="white" font-size="40"%3E?%3C/text%3E%3C/svg%3E';
}

Devvit.addMenuItem({
  label: 'Create ${title.replace(/'/g, "\\'")}',
  location: 'subreddit',
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    const subreddit = await reddit.getCurrentSubreddit();
    
    const post = await reddit.submitPost({
      title: '${title.replace(/'/g, "\\'")}',
      subredditName: subreddit.name,
      preview: (
        <vstack padding="medium" alignment="center middle">
          <text size="xxlarge" weight="bold">🎮 Game</text>
          <text>Click to play!</text>
        </vstack>
      )
    });
    
    ui.showToast({ text: 'Post created!', appearance: 'success' });
    ui.navigateTo(post);
  }
});

export default Devvit;
`;

