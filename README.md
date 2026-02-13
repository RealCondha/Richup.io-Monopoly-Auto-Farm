# RichUp Bot

Automated coin farming for [RichUp.io](https://richup.io). Runs as a Tampermonkey userscript with a GUI, or standalone from browser console.

## How It Works

You run one main account that plays to win, and at least 3 alt accounts that feed it. Alts play normally for 70 turns, then auto-bankrupt — transferring their assets to whoever's left. Main never bankrupts, just keeps collecting. After each game, all tabs auto-rejoin and the cycle repeats.

## Setup (Tampermonkey — Recommended)

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser
2. Create a new script and paste the contents of `richup-bot.user.js`
3. Open RichUp.io in your main browser window
4. Open **separate incognito windows** for each alt (minimum 3 recommended)
   - Each alt MUST be in its own incognito window or browser profile
   - Enable Tampermonkey in incognito mode (Extensions → Tampermonkey → Allow in Incognito)
5. Main creates a private room, alts join via room link
6. Set **starting money to max** in game settings
7. Click **▶ Main** in the floating panel on your main window
8. Click **▶ Alt** in the floating panel on each alt window
9. Bot handles everything — color selection, joining, gameplay, bankruptcy, and rejoining
10. Survives page reloads automatically — no need to re-paste scripts

## Setup (Console — Alternative)

1. Open RichUp.io, create room, alts join
2. Set starting money to max
3. Open console (F12 → Console) and paste:
   - Main window → `main.js`
   - Each alt window → `alts.js`
4. Scripts don't survive page reloads — you'll need to re-paste after disconnect

## Config

Top of the userscript (or individual files):

```javascript
const CHECK_MS = 700;          // poll interval (ms)
const LOBBY_WAIT = 6000;       // lobby wait before auto-starting (ms)
const BANKRUPT_AFTER = 70;     // turns before alt auto-bankruptcy
```

## Disconnect Recovery

RichUp sometimes drops your connection (Cloudflare verification, internet hiccup, etc.). When this happens:

1. Bot detects the "Lost connection" overlay and **auto-pauses** — no erratic clicking
2. Tab title changes to `[!] DISCONNECTED` so you can spot it
3. Open a new tab → go to richup.io → verify if prompted → close it
4. Go back to the disconnected tab — the overlay clears and the bot **auto-resumes**
5. With Tampermonkey, even a full page reload restarts the bot automatically

## Console Output

```
[MAIN] Running | games: 5 | turns: 12
[MAIN] Joined
[MAIN] Roll
[alt_a3f2] Turn 45/70
[alt_a3f2] Bankrupted
[alt_x9k1] Joined
[MAIN] Connection lost — paused
[MAIN] Reconnected
```

## Technical Details

- Full pointer/mouse event chain for React compatibility
- React fiber tree walk to invoke internal handlers up to 15 levels deep
- Button blacklist prevents accidental clicks on share/copy/invite/sound/settings
- Swatch detection via DOM tree walk with SVG-based button filtering
- Per-alt isolation using sessionStorage with random IDs
- Identity persistence — alt names/settings captured and restored between games
- Disconnect detection with auto-pause/resume
- Randomized timing jitter on all actions

## Reset

```javascript
localStorage.clear()
sessionStorage.clear()
location.reload()
```

## Tips

- Use at least **3 alts** for consistent wins — with fewer, the main might not always be last standing
- Set starting money to **max** — more money = more assets to collect when alts bankrupt
- If an alt gets stuck on the color screen, just refresh (Tampermonkey restarts automatically)
- Room persists via "Another game" — you don't need to manually create new rooms

**Use at your own risk.**
