# RichUp Bot

Automated coin farming for [RichUp.io](https://richup.io). Runs entirely from browser console — no extensions, no downloads.

## How It Works

You run one main account that plays to win, and at least 3 alt accounts that feed it. Alts play normally for 70 turns, then auto-bankrupt — transferring their assets to whoever's left. Main never bankrupts, just keeps collecting. After each game, all tabs auto-rejoin and the cycle repeats.

## Setup

1. Open RichUp.io in your main browser
2. Open **separate incognito windows** for each alt (minimum 3 recommended)
   - Each alt MUST be in its own incognito window or browser profile — tabs in the same window share storage and will conflict
3. Main creates a private room, alts join via room link
4. Set **starting money to max** in game settings for faster farming
5. Open console (F12 → Console) and paste:
   - Main window → `main.js`
   - Each alt window → `alts.js`
6. Bot handles everything from here — color selection, joining, gameplay, bankruptcy, and rejoining

## Scripts

| Script | Role | Behavior |
|--------|------|----------|
| `main.js` | Primary account | Plays to win. Rolls, buys everything, never bankrupts. Handles lobby start. |
| `alts.js` | Feeder accounts | Plays 70 turns then auto-bankrupts. Preserves identity across games. Any alt that ends up as host will start the next game. |

## Config

Top of each file:

```javascript
// alts.js
const MY_COLOR = -1;           // color index (-1 = auto-assign)
const BANKRUPT_AFTER = 70;     // turns before auto-bankruptcy
const CHECK_MS = 700;          // poll interval (ms)

// main.js  
const LOBBY_WAIT = 6000;       // wait in lobby before auto-starting (ms)
```

## Console Output

```
[MAIN] Running | games: 5 | turns: 12
[MAIN] Joined
[MAIN] Roll
[alt_a3f2] Turn 45/70
[alt_a3f2] Bankrupted
[alt_x9k1] Swatch 3/11 (attempt 0)
[alt_x9k1] Joined
```

## Technical Details

- Full pointer/mouse event chain for React compatibility (hover → pointerdown → mousedown → pointerup → mouseup → click)
- React fiber tree walk to invoke internal handlers (onClick, onMouseDown, onPointerDown) up to 15 levels deep
- Swatch detection via DOM tree walk — finds the "Select your appearance" heading container, filters child buttons by size + SVG content
- Per-alt isolation using sessionStorage with random IDs — multiple alts don't interfere
- Identity persistence — alt names/settings are captured and restored between games

## Reset

```javascript
localStorage.clear()
sessionStorage.clear()
location.reload()
```

## Tips

- Use at least **3 alts** for consistent wins — with fewer, the main might not always be last standing
- Set starting money to **max** — more money = more assets to collect when alts bankrupt
- If an alt gets stuck on the color screen, just refresh and re-paste the script
- Room persists via "Another game" — you don't need to manually create new rooms

**Use at your own risk.**
