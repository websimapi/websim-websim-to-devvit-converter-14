export const getMainTsx = (title, webviewPath) => `/** @jsx Devvit.createElement */
/** @jsxFrag Devvit.Fragment */

import { Devvit } from '@devvit/public-api';
import { DevvitBridge } from './devvit-bridge.js';

Devvit.configure({
  redditAPI: true,
  redis: true,
  http: true,
  realtime: true, // Enable Realtime
});

Devvit.addCustomPostType({
  name: '${title.replace(/'/g, "\\'")}',
  height: 'tall',
  render: (context) => {
    // Initialize bridge with fresh context for every render
    const bridge = new DevvitBridge(context);

    // Fetch user identity using useState with async initializer
    const [userInfo] = context.useState<any>(async () => {
      try {
        const user = await context.reddit.getCurrentUser();
        if (user) {
          const snoovatarUrl = await context.reddit.getSnoovatarUrl(user.username);
          return {
            id: user.id,
            username: user.username,
            avatarUrl: snoovatarUrl || getDefaultAvatar(),
            isAnonymous: false
          };
        } else {
          return {
            id: 'anonymous',
            username: 'Guest',
            avatarUrl: getDefaultAvatar(),
            isAnonymous: true
          };
        }
      } catch (error) {
        console.error('[Devvit] Failed to fetch user info:', error);
        return {
          id: 'anonymous',
          username: 'Guest',
          avatarUrl: getDefaultAvatar(),
          isAnonymous: true
        };
      }
    });

    // Handle messages from webview
    const onMessage = async (event: any) => {
      // Robust message parsing. Devvit 0.11+ passes JSON directly.
      let msg = event;
      
      // Attempt to extract the actual payload if it's wrapped oddly
      if (event && typeof event === 'object') {
          // Case: { type: '...', data: '...' } (Standard)
          if (event.type && (event.data !== undefined || event.messageId)) {
              msg = event;
          } 
          // Case: { data: { type: '...' } } (Wrapped in data property)
          else if (event.data && typeof event.data === 'object') {
              msg = event.data;
          }
      } else if (typeof event === 'string') {
          try { msg = JSON.parse(event); } catch(e) {}
      }

      const { type, data, messageId } = msg || {};
      
      if (!type) {
          if (msg && Object.keys(msg).length > 0) {
            console.log('[Devvit] Received unknown message format:', JSON.stringify(msg));
          }
          return;
      }

      // Console logging passthrough
      if (type === 'console') {
          const args = msg.args || [];
          console.log('[Web]', ...args);
          return;
      }

      // Debug log for bridge
      console.log(\`[Devvit] Bridge Call: \${type} (\${messageId || 'no-id'})\`);
      
      try {
        // Pass userInfo to allow bridge to skip redundant server calls
        const result = await bridge.handleMessage(type, data, userInfo);
        
        // Send response back to webview
        if (messageId) {
            await context.ui.webView.postMessage('game-webview', {
                type: 'devvit-response',
                data: { messageId, result }
            });
        }
      } catch (error: any) {
        console.error(\`[Devvit] Error handling \${type}:\`, error);
        if (messageId) {
            await context.ui.webView.postMessage('game-webview', {
                type: 'devvit-response',
                data: { messageId, error: error.message || 'Unknown error' }
            });
        }
      }
    };

    if (!userInfo) {
      return (
        <vstack height="100%" width="100%" alignment="center middle">
          <text size="large">Loading...</text>
        </vstack>
      );
    }

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
  return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%233b82f6"/%3E%3Ctext x="50" y="50" text-anchor="middle" dy=".3em" fill="white" font-size="40" font-family="Arial"%3E?%3C/text%3E%3C/svg%3E';
}

Devvit.addMenuItem({
  label: 'Create ${title.replace(/'/g, "\\'")}',
  location: 'subreddit',
  // forUserType: 'moderator', // Optional constraint
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    try {
      const subreddit = await reddit.getCurrentSubreddit();
      const post = await reddit.submitPost({
        title: '${title.replace(/'/g, "\\'")}',
        subredditName: subreddit.name,
        preview: (
          <vstack padding="medium" cornerRadius="medium" height="100%" alignment="center middle" backgroundColor="#0f172a">
            <text size="xxlarge" weight="bold" color="#f8fafc">${title.replace(/'/g, "\\'")}</text>
            <spacer size="medium" />
            <text size="large" color="#94a3b8">Click to start playing</text>
            <spacer size="large" />
            <button appearance="primary" onPress={() => context.ui.navigateTo(post)}>Launch Game</button>
          </vstack>
        ),
        // Splash screen configuration (for supported clients)
        splash: {
          appDisplayName: '${title.replace(/'/g, "\\'")}',
          buttonLabel: 'Play Now',
          description: 'A WebSim Game converted to Devvit',
          entryUri: '${webviewPath}', // Typically index.html
        }
      });
      ui.showToast({ text: 'Post created!', appearance: 'success' });
      ui.navigateTo(post);
    } catch (error) {
      console.error('Error creating post:', error);
      ui.showToast({ text: 'Failed to create post', appearance: 'neutral' });
    }
  },
});

export default Devvit;
`;

