export const getMainTsx = (title, webviewPath) => `/** @jsx Devvit.createElement */
/** @jsxFrag Devvit.Fragment */

import { Devvit } from '@devvit/public-api';
import { DevvitBridge } from './devvit-bridge.js';

Devvit.configure({
  redditAPI: true,
  redis: true,
  http: false,
});

// Track active bridges by post
const activeBridges = new Map<string, DevvitBridge>();

Devvit.addCustomPostType({
  name: '${title.replace(/'/g, "\\'")}',
  height: 'tall',
  render: (context) => {
    const postId = context.postId || 'preview';
    
    // Initialize bridge for this post if not exists
    if (!activeBridges.has(postId)) {
      activeBridges.set(postId, new DevvitBridge(context));
    }
    const bridge = activeBridges.get(postId)!;

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
      // In Devvit Blocks, the event object IS the message payload
      const msg = event;
      const { type, data, messageId } = msg;
      
      // Console logging passthrough
      if (type === 'console') {
          const args = msg.args || [];
          console.log('[Web]', ...args);
          return;
      }

      console.log(\`[Devvit] Received message: \${type}\`);
      
      try {
        const result = await bridge.handleMessage(type, data);
        // Send response back to webview
        context.ui.webView.postMessage('game-webview', {
          type: 'devvit-response',
          data: { messageId, result }
        });
      } catch (error: any) {
        console.error(\`[Devvit] Error handling message \${type}:\`, error);
        context.ui.webView.postMessage('game-webview', {
          type: 'devvit-response',
          data: { messageId, error: error.message || 'Unknown error' }
        });
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
          <vstack padding="medium" cornerRadius="medium">
            <text size="xlarge" weight="bold">${title.replace(/'/g, "\\'")}</text>
            <spacer />
            <text color="neutral-content-weak">Click to play!</text>
          </vstack>
        ),
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

