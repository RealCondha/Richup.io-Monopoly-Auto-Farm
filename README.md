# RichUp.io Bot

A fully automated bot for farming games on [RichUp.io](https://richup.io/). This bot handles everything from game creation, rolling the dice, buying properties, managing jail, and automatically bankrupting alts to boost the main account.

---

## 🚀 Features (v2.8.0)

-   **Automatic Farming:** Plays game loops automatically (Join -> Play -> Bankrupt -> Repeat).
-   **Anti-Cheat Bypass:** Uses random jitter and human-like delays to avoid detection.
-   **Keep-Alive System:** Includes a specialized mode to bypass Cloudflare timeouts and keep the session active, even when minimized (Anti-Throttle Worker).
-   **Multi-Instance Support:** Run as many instances as your PC can handle.
-   **GUI Panel:** Floating control panel to switch between Main and Alt modes on the fly.
-   **Smart Interaction:** Handles modals, popups, and random events automatically.
-   **Sandbox Compatible:** Works with Tampermonkey/Greasemonkey strict security modes.

---

## 🛠 Installation

### 1. Install Userscript Manager
You need a userscript manager to run this bot. We recommend:
-   **Tampermonkey** (Chrome, Edge, Firefox, Opera)

### 2. Install the Script
1.  Click on the extension icon and select **Create a new script**.
2.  Copy the contents of `richup-bot.user.js`.
3.  Paste it into the editor and hit **File > Save** (Ctrl+S).

---

## 🎮 How to Use

### 1. Main Account
1.  Open [RichUp.io](https://richup.io/).
2.  You will see the **RichUp Bot** panel in the top-right.
3.  Click **▶ Main**.
4.  Create a "Private Game".
5.  Set the room to **4 Players**.
6.  Copy the Invite Link.

### 2. Alt Accounts
1.  Open a new **Incognito Window** (or a different browser profile).
2.  Paste the Invite Link.
3.  When the panel appears, click **▶ Alt**.
4.  The bot will automatically pick a color, join, and play.
5.  **Repeat** for as many alts as you need (up to 3 per room).

### 📝 Important Notes
*   **Keep-Alive Tab:**
    *   Open a new tab and click the **↻ Keep-Alive Tab** button in the bot panel.
    *   This opens a special page that refreshes automatically to keep your Cloudflare session valid.
    *   **Do NOT minimize** this specific tab completely (you can put it in a separate window behind others, but don't minimize to taskbar if your browser throttles heavily).
    *   The bot uses a Web Worker to fight throttling, but keeping it visible (even slightly) is safer.
    *   You need one Keep-Alive tab for your Main session and one for your Alts (Incognito).

*   **Bankruptcy:**
    *   Alts are configured to automatically **Bankrupt** after **70 turns**.
    *   This speeds up the farming process significantly.
    *   Logic: At turn 70, the bot will click "Declare Bankruptcy", confirm it, restart, and rejoin the next game.

*   **Console Version:**
    *   If you prefer not to use an extension, you can paste the code from `main.js` or `alts.js` directly into the Browser Console (F12).

---

### 🛡️ Cloudflare Bypass & Anti-Bot
RichUp uses Cloudflare Turnstile to stop bots. You have two ways to handle this:

#### Option A: NopeCHA Extension (Recommended/Free)
1.  Install the **NopeCHA: CAPTCHA Solver** extension in your browser.
    *   This gives you **~100 free solves per 24 hours**.
    *   This is enough for most users as the bot only needs to verify occasionally.
2.  **Open the "Keep-Alive" Tab:**
    *   Click **↻ Keep-Alive Tab** in the bot panel.
    *   Leave this tab Open (do not close it, just keep it in the background).
    *   When Cloudflare appears, **NopeCHA** will automatically solve it for you.
    *   The bot detects the solve and reloads the page to continue farming.

#### Option B: API Key (Paid Fallback)
If you run out of free credits or want to run 24/7 with many instances:
1.  Get an API Key from [2Captcha](https://2captcha.com/).
2.  In the Bot Panel, click **🔑 Set API Key**.
3.  Paste your key.
4.  The bot will now use your key to solve captchas automatically without needing the extension (though the extension is still faster/better).

---

## 🧩 Troubleshooting

*   **Bot not clicking?** Ensure the page is focused or at least visible on one monitor.
*   **Cloudflare Loop?** Make sure you have the **Keep-Alive Tab** open and either the **Extension installed** OR an **API Key** set.

---

**Happy Farming! 🎲**
