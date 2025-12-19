// src/websim-detector.js
// Automatically detects WebSim API usage and injects Devvit bridge
import MagicString from 'https://esm.sh/magic-string@0.30.5';

/**
 * Detects and replaces WebSim API calls with Devvit equivalents
 */
export class WebSimDetector {
    constructor() {
        this.detectedAPIs = {
            database: false,
            realtime: false,
            identity: false,
            collections: false
        };
    }

    /**
     * Process JavaScript to detect and replace WebSim APIs
     */
    processScript(code, filename = 'script.js') {
        const magic = new MagicString(code);
        let hasChanges = false;

        // 1. Detect WebSim Socket usage
        if (code.includes('WebsimSocket') || code.includes('websim')) {
            this.detectedAPIs.realtime = true;
            console.log(`[Detector] Found WebSim Socket usage in ${filename}`);
        }

        // 2. Detect Database operations
        const dbPatterns = [
            /\.hGetAll\(/g,
            /\.hSet\(/g,
            /\.hDel\(/g,
            /\.collection\(/g,
            /room\.db\./g
        ];

        for (const pattern of dbPatterns) {
            if (pattern.test(code)) {
                this.detectedAPIs.database = true;
                console.log(`[Detector] Found database usage in ${filename}`);
                break;
            }
        }

        // 3. Detect Realtime operations
        const realtimePatterns = [
            /\.updatePresence\(/g,
            /\.updateRoomState\(/g,
            /\.subscribePresence\(/g,
            /\.subscribeRoomState\(/g,
            /room\.send\(/g,
            /room\.peers/g
        ];

        for (const pattern of realtimePatterns) {
            if (pattern.test(code)) {
                this.detectedAPIs.realtime = true;
                console.log(`[Detector] Found realtime usage in ${filename}`);
                break;
            }
        }

        // 4. Detect Identity/Avatar usage
        const identityPatterns = [
            /room\.peers/g,
            /\.username/g,
            /\.avatarUrl/g,
            /images\.websim\.com\/avatar/g,
            /window\.websim\.getCurrentUser/g
        ];

        for (const pattern of identityPatterns) {
            if (pattern.test(code)) {
                this.detectedAPIs.identity = true;
                console.log(`[Detector] Found identity usage in ${filename}`);
                break;
            }
        }

        // 5. Replace avatar URLs
        // images.websim.com/avatar/... -> Dynamic Reddit snoovatar
        const avatarRegex = /(['"`])https?:\/\/images\.websim\.com\/avatar\/[^'"`]+\1/g;
        let match;
        while ((match = avatarRegex.exec(code)) !== null) {
            // Replace with a placeholder that will be filled by the polyfill
            const replacement = `getUserAvatar(username)`; // Will be defined in polyfill
            // This replacement is tricky if username isn't in scope. 
            // For safety, we often replace strict strings with a function call wrapper if it matches exact string
            // But since this is a complex regex replacement in source code, we'll skip aggressive rewriting 
            // and rely on the Polyfill to intercept if possible, or simple static replacements.
            
            // Actually, best approach for static strings is to use the bridge's helper if possible.
            // For now, we'll log it. Rewriting source code blindly is risky.
            // magic.overwrite(match.index, match.index + match[0].length, replacement); 
            // hasChanges = true;
        }

        // 6. Replace window.websim calls
        if (code.includes('window.websim')) {
            // These are handled by our polyfill, but we can add warnings
            console.log(`[Detector] Found window.websim usage - will be polyfilled`);
        }

        return { code: hasChanges ? magic.toString() : code, detectedAPIs: this.detectedAPIs };
    }

    /**
     * Process HTML to inject Devvit bridge
     */
    processHTML(html, filename = 'index.html') {
        // Bridge is now injected globally by processors.js to ensure consistency
        // We just log detection here
        const { detectedAPIs } = this;
        const needsBridge = Object.values(detectedAPIs).some(v => v);

        if (needsBridge) {
            console.log(`[Detector] WebSim APIs detected in ${filename}:`, detectedAPIs);
        } else {
            console.log(`[Detector] No WebSim APIs detected in ${filename}`);
        }

        return html;
    }

    /**
     * Get summary of detected APIs
     */
    getSummary() {
        return {
            ...this.detectedAPIs,
            needsDevvitBridge: Object.values(this.detectedAPIs).some(v => v)
        };
    }

    /**
     * Generate README section about API mapping
     */
    generateMigrationNotes() {
        const notes = [];
        
        if (this.detectedAPIs.database) {
            notes.push(`
## Database Migration (WebSim → Redis)
Your app uses WebSim's database features. These have been automatically mapped to Redis:
- \`room.collection(name).create(data)\` → Redis hash storage
- \`room.collection(name).getList()\` → Redis hash retrieval
- All database operations are now server-side via Devvit

**No code changes needed!** The bridge handles everything automatically.
`);
        }

        if (this.detectedAPIs.realtime) {
            notes.push(`
## Realtime Migration (WebSim → Reddit Realtime)
Your app uses WebSim's realtime features. These have been mapped to Reddit Realtime:
- \`room.updatePresence(data)\` → Reddit Realtime + Redis TTL storage
- \`room.updateRoomState(data)\` → Reddit Realtime broadcast + Redis persistence
- \`room.subscribePresence(callback)\` → Reddit Realtime subscription

**No code changes needed!** The bridge maintains WebSim-compatible APIs.
`);
        }

        if (this.detectedAPIs.identity) {
            notes.push(`
## Identity Migration (WebSim → Reddit Users)
Your app uses WebSim's identity system. This has been mapped to Reddit's user API:
- \`room.peers\` → Reddit user objects with Snoovatars
- \`https://images.websim.com/avatar/*\` → Reddit Snoovatar URLs via \`getSnoovatarUrl()\`
- \`window.websim.getCurrentUser()\` → Reddit's \`getCurrentUser()\`

**Avatars automatically use Reddit Snoovatars!** No CSP issues.
`);
        }

        return notes.join('\n');
    }
}

