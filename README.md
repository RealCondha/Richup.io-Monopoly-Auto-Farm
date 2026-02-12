# RichUp Bot

Automated farming for RichUp.io. Runs in browser console.

## Setup

1. Open RichUp.io in your main browser window
2. Open incognito windows for each alt account
3. Main creates room, alts join via room code
4. Paste scripts in console (F12):
   - Main: `main.js`
   - Alts: `alts.js`
5. Done. Runs infinite loop.

## How It Works

- **main.js** - Your primary account. Plays to win, never bankrupts.
- **alts.js** - Sacrificial accounts. Play 70 turns, auto-bankrupt, rejoin via "Another game".
- Main wins → gets coins → cycle repeats.

## Config

Edit top of either file:

```javascript
const CONFIG = {
    DEBUG: true,              // Console spam
    BASE_DELAY: 500,          // Polling speed (ms)
    MAX_DELAY: 2000,          // Idle throttle
    BANKRUPT_THRESHOLD: 70,   // Alts only
}
```

## Features

- Multi-method button detection (text, XPath, CSS)
- Buy priority (buys before rolling)
- Adaptive timing (500ms-2000ms)
- Lag prevention (2hr safety, cycle logging)
- Persistent stats (localStorage)
- Modal handling (4 methods for bankruptcy)

## Stats

Check console for:
- `Game X completed!` 
- `Running for X mins | Y cycles | Z games`

## Reset

```javascript
localStorage.clear()
location.reload()
```

## Notes

- Use incognito windows for alts to stay logged in separately
- Room stays open via "Another game"
- Alts need 70 turns before bankruptcy kicks in
- Main needs to be last one standing to win

**Use at your own risk. Violates ToS probably.**
