// ==UserScript==
// @name         RichUp Bot
// @namespace    richup-bot
// @version      2.8.1
// @description  Auto-farm RichUp.io — pick Main or Alt mode per tab. Includes DEBUG logging and state visualization.
// @match        https://richup.io/*
// @connect      api.capmonster.cloud
// @connect      api.2captcha.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // Access the real window object for events and timers
    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // ═══════════════════════════════════════════════════════
    // CLOUDFLARE KEEP-ALIVE (Anti-Throttle Worker)
    // ═══════════════════════════════════════════════════════
    if (new URLSearchParams(win.location.search).get('bot_mode') === 'keepalive') {

        // Worker to keep checking every second even if minimized
        const kaBlob = new Blob([`
            self.onmessage = function() { setInterval(() => self.postMessage('tick'), 1000); };
        `], { type: 'application/javascript' });
        const kaWorker = new Worker(URL.createObjectURL(kaBlob));

        kaWorker.onmessage = () => {
            const title = document.title;

            // Update Status Overlay Timestamp
            const statusEl = document.getElementById('rb-ka-status');
            if (statusEl) {
                statusEl.innerText = `Active | Last Check: ${new Date().toLocaleTimeString()}`;
                statusEl.style.color = '#fff';
                statusEl.style.fontSize = '10px';
                statusEl.style.padding = '2px 5px';
                statusEl.style.background = '#10b981'; // Green bg
            }

            // 1. Stuck on Cloudflare?
            if (title === 'Just a moment...' || title.includes('Attention Required')) {
                if (win.kaRefreshTimer) { clearTimeout(win.kaRefreshTimer); win.kaRefreshTimer = null; }
                if (!document.title.includes('Verifying')) {
                    document.title = "Verifying... - RichUp";
                    if (statusEl) statusEl.style.background = '#eab308'; // Yellow
                }
            }
            // 2. Success?
            else if (document.body && !document.body.innerText.includes('security verification')) {
                // If not already scheduled, schedule refresh
                if (!win.kaRefreshTimer) {
                    document.title = "RichUp Keep-Alive: Active";

                    // Create Status Overlay if missing
                    if (!document.getElementById('rb-ka-status')) {
                        const d = document.createElement('div');
                        d.id = 'rb-ka-status';
                        d.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:18px;background:#10b981;z-index:999999;pointer-events:none;display:flex;align-items:center;padding-left:5px;font-family:monospace;';
                        document.body.appendChild(d);
                    }

                    // REFRESH: 60 seconds
                    win.kaRefreshTimer = setTimeout(() => win.location.reload(), 60000);
                }
            }

            // Optional Solver Logic (Legacy)
            if (!win.solverAttempted && (title === 'Just a moment...' || title.includes('Attention Required'))) {
                const apiKey = GM_getValue('solver_key', '');
                if (apiKey && apiKey.length > 5) {
                    win.solverAttempted = true;
                    setTimeout(async () => {
                        const sk = document.querySelector('[data-sitekey]');
                        if (sk) {
                            const key = sk.getAttribute('data-sitekey');
                            const token = await solveTurnstile(key, win.location.href);
                            if (token) {
                                let input = document.querySelector('[name="cf-turnstile-response"]') || document.querySelector('[name="g-recaptcha-response"]');
                                if (!input) {
                                    input = document.createElement('input');
                                    input.type = 'hidden';
                                    input.name = 'cf-turnstile-response';
                                    document.body.appendChild(input);
                                }
                                input.value = token;
                                if (typeof turnstile !== 'undefined' && turnstile.callback) turnstile.callback(token);
                                setTimeout(() => win.location.reload(), 2000);
                            }
                        }
                    }, 2000);
                }
            }
        };
        kaWorker.postMessage('start');
        return;
    }

    // ═══════════════════════════════════════════════════════
    // CONFIG
    // ═══════════════════════════════════════════════════════

    const CHECK_MS = 700;
    const BANKRUPT_AFTER = 70;

    // ═══════════════════════════════════════════════════════
    // LOGGING & DEBUG
    // ═══════════════════════════════════════════════════════

    let logCount = 0;
    function log(msg, type = 'info') {
        if (++logCount % 80 === 0) console.clear(); // Prevent memory bloat from infinite logs
        const prefix = `[RichUp Bot] ${new Date().toLocaleTimeString()} `;
        const style = type === 'error' ? 'color: #ff6b6b' : (type === 'debug' ? 'color: #888' : 'color: #a78bfa');
        console.log(`%c${prefix}${msg}`, style);
    }

    function updateStateDisplay(state) {
        const el = document.getElementById('rb-status-state');
        if (el) {
            el.textContent = state;
            el.className = 'state ' + state.toLowerCase();
        }
    }

    // ═══════════════════════════════════════════════════════
    // ANTI-THROTTLE: Web Worker timer (Bot Loop)
    // ═══════════════════════════════════════════════════════

    const _workerBlob = new Blob([`
    self.onmessage = function(e) {
        if (e.data.cmd === 'sleep') {
            const id = e.data.id;
            setTimeout(function() { self.postMessage({ id: id }); }, e.data.ms);
        }
    };
`], { type: 'application/javascript' });
    const _timerWorker = new Worker(URL.createObjectURL(_workerBlob));
    let _sleepId = 0;
    const _sleepCallbacks = {};

    _timerWorker.onmessage = function (e) {
        const cb = _sleepCallbacks[e.data.id];
        if (cb) { delete _sleepCallbacks[e.data.id]; cb(); }
    };

    function sleep(ms) {
        const actualMs = ms + Math.random() * 200;
        return new Promise(function (resolve) {
            const id = ++_sleepId;
            _sleepCallbacks[id] = resolve;
            _timerWorker.postMessage({ cmd: 'sleep', id: id, ms: actualMs });
        });
    }

    // ═══════════════════════════════════════════════════════
    // SHARED UTILS (Safe Click Logic)
    // ═══════════════════════════════════════════════════════

    function norm(s) { return s.trim().replace(/\s+/g, ' ').toLowerCase(); }

    function doClick(el) {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        log(`Clicking: "${el.textContent.trim().substring(0, 20)}..."`, 'debug');

        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        // Use 'win' (unsafeWindow) for events
        const o = { bubbles: true, cancelable: true, view: win, clientX: x, clientY: y, button: 0, buttons: 1 };
        const oUp = { ...o, buttons: 0 };

        el.dispatchEvent(new PointerEvent('pointerover', oUp));
        el.dispatchEvent(new MouseEvent('mouseover', oUp));
        el.dispatchEvent(new PointerEvent('pointerenter', { ...oUp, bubbles: false }));
        el.dispatchEvent(new MouseEvent('mouseenter', { ...oUp, bubbles: false }));
        el.dispatchEvent(new PointerEvent('pointerdown', o));
        el.dispatchEvent(new MouseEvent('mousedown', o));
        el.dispatchEvent(new PointerEvent('pointerup', oUp));
        el.dispatchEvent(new MouseEvent('mouseup', oUp));
        el.dispatchEvent(new MouseEvent('click', oUp));

        // React Fiber traversal
        let node = el;
        for (let d = 0; d < 4 && node; d++) {
            if (_tryReact(node, oUp)) return;
            node = node.parentElement;
        }
    }

    function _tryReact(el, o) {
        const fe = {
            type: 'click', target: el, currentTarget: el,
            clientX: o.clientX, clientY: o.clientY,
            bubbles: true, cancelable: true, button: 0,
            preventDefault() { }, stopPropagation() { }, persist() { },
            nativeEvent: new MouseEvent('click', o),
            isDefaultPrevented() { return false },
            isPropagationStopped() { return false }
        };

        // Fix: Unwrapping for Sandbox Access
        const safeEl = el.wrappedJSObject || el;
        const keys = Object.keys(safeEl);

        for (const k of keys) {
            if (k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')) {
                const p = safeEl[k]; if (!p) continue;
                if (typeof p.onClick === 'function') { try { p.onClick(fe); return true; } catch (e) { } }
                if (typeof p.onMouseDown === 'function') { try { p.onMouseDown({ ...fe, type: 'mousedown' }); return true; } catch (e) { } }
            }
            if (k.startsWith('__reactFiber$')) {
                let f = safeEl[k], d = 0;
                while (f && d < 10) {
                    const mp = f.memoizedProps;
                    if (mp) {
                        if (typeof mp.onClick === 'function') { try { mp.onClick(fe); return true; } catch (e) { } }
                        if (typeof mp.onMouseDown === 'function') { try { mp.onMouseDown({ ...fe, type: 'mousedown' }); return true; } catch (e) { } }
                    }
                    f = f.return; d++;
                }
            }
        }
        return false;
    }

    // buttons with these words in their text are NEVER clicked AUTOMATICALLY
    const BLACKLIST = [
        'share', 'copy', 'invite', 'sound', 'spectate', 'return to lobby',
        'go to lobby', 'get more', 'change appearance', 'login', 'sign up',
        'see all', 'private room', 'log in', 'settings', 'appearance',
        'how to play', 'close', 'chat', 'maximum', 'friends', 'create',
        'richup', 'toggle', 'mute', 'unmute', 'leaderboard', 'profile',
        'report', 'kick', 'emoji', 'help', 'support', 'discord', 'tutorial',
        'rules', 'video'
    ];

    function getBtn(match) {
        // Modal check
        if (document.querySelector('.modal-container') || document.querySelector('[class*="Modal"]')) {
            // pass
        }

        for (const btn of document.querySelectorAll('button')) {
            if (btn.disabled) continue;
            if (btn.closest('#richup-bot-panel')) continue;
            const tl = norm(btn.textContent);
            if (tl.length === 0 || tl.length > 50) continue;

            // If the btn text includes 'votekick', we MUST NOT skip it, because we need it for failsafe
            if (tl.includes('votekick') || tl.includes('kick')) {
                // Pass. Fall down to match check.
            } else if (BLACKLIST.some(b => tl.includes(b))) continue;

            const isMatch = (typeof match === 'string' && tl === match.toLowerCase()) ||
                (typeof match === 'function' && match(tl));

            // EXCEPTION: If we are specifically looking for 'votekick', skip blacklist check
            if (isMatch || (typeof match === 'string' && match.toLowerCase() === 'votekick')) {
                // If the user function matcher explicitly wants "votekick", we ensure it passes
                // OPTIMIZATION: Only evaluate size if text matches to prevent Layout Thrashing lag
                const rect = btn.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) return btn;
            }
        }
        return null;
    }

    // Lobby Detection
    function isInLobby() {
        const text = document.body.innerText.toLowerCase();
        return text.includes('game settings') ||
            text.includes('waiting for players') ||
            text.includes('maximum players') ||
            text.includes('select your');
    }

    function isModalOpen() {
        const text = document.body.innerText;
        return text.includes('How to play') && text.includes('All players start with');
    }

    // Swatches
    function findSwatches() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let textNode;
        while (textNode = walker.nextNode()) {
            if (textNode.textContent.toLowerCase().includes('select your')) {
                let container = textNode.parentElement;
                for (let lvl = 0; lvl < 3 && container; lvl++) {
                    const sw = filterSwatchButtons(container.querySelectorAll('button:not([disabled])'));
                    if (sw.length >= 4) return sw;
                    container = container.parentElement;
                }
                break;
            }
        }
        return filterSwatchButtons(document.querySelectorAll('.swatch, [class*="swatch"]'), true);
    }

    function filterSwatchButtons(buttons, requireColor) {
        return [...buttons].filter(btn => {
            if (btn.closest('#richup-bot-panel')) return false;
            if (btn.getAttribute('role') === 'switch') return false;
            if (btn.hasAttribute('aria-checked')) return false;
            if (btn.closest('[class*="setting"]')) return false;

            const textContent = norm(btn.textContent + ' ' + (btn.getAttribute('aria-label') || ''));
            const htmlContent = btn.innerHTML.toLowerCase();
            if (BLACKLIST.some(b => textContent.includes(b) || htmlContent.includes(b))) return false;

            if (htmlContent.includes('question') || htmlContent.includes('info') ||
                htmlContent.includes('sound') || htmlContent.includes('volume') ||
                htmlContent.includes('speaker') || htmlContent.includes('mute')) return false;

            const r = btn.getBoundingClientRect();
            if (r.width < 5 || r.width > 120 || r.height < 5 || r.height > 120) return false;
            if (btn.textContent.trim().length > 3) return false;

            if (requireColor) {
                const s = window.getComputedStyle(btn);
                const bg = s.backgroundColor;
                if (bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return false;
                const inlineColor = btn.style.color || btn.style.backgroundColor;
                if (!inlineColor) return false;
            }
            return true;
        });
    }

    function onColorScreen() {
        const body = document.body.innerText.toLowerCase();
        return body.includes('select your') && body.includes('appearance');
    }

    // ═══════════════════════════════════════════════════════
    // SOLVER LOGIC
    // ═══════════════════════════════════════════════════════

    async function solveTurnstile(sitekey, pageUrl) {
        const apiKey = GM_getValue('solver_key', '');
        if (!apiKey) return null;

        log('[Solver] Creating task for sitekey: ' + sitekey, 'debug');
        const domain = '2captcha.com';
        const createUrl = `http://${domain}/in.php?key=${apiKey}&method=turnstile&sitekey=${sitekey}&pageurl=${pageUrl}&json=1`;

        const taskId = await new Promise(resolve => {
            GM_xmlhttpRequest({
                method: "GET", url: createUrl,
                onload: function (response) {
                    try {
                        const r = JSON.parse(response.responseText);
                        if (r.status === 1) resolve(r.request);
                        else { log('[Solver] Create Error: ' + JSON.stringify(r), 'error'); resolve(null); }
                    } catch (e) { log('[Solver] Parse Error', 'error'); resolve(null); }
                },
                onerror: function (e) { log('[Solver] Network Error', 'error'); resolve(null); }
            });
        });

        if (!taskId) return null;
        log('[Solver] Task ID: ' + taskId + ', pooling...', 'info');

        for (let i = 0; i < 20; i++) {
            await sleep(5000);
            const resultUrl = `http://${domain}/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`;
            const token = await new Promise(resolve => {
                GM_xmlhttpRequest({
                    method: "GET", url: resultUrl,
                    onload: function (response) {
                        try {
                            const r = JSON.parse(response.responseText);
                            if (r.status === 1) resolve(r.request);
                            else if (r.request === 'CAPCHA_NOT_READY') resolve('WAIT');
                            else { log('[Solver] Result Error: ' + JSON.stringify(r), 'error'); resolve('ERROR'); }
                        } catch (e) { resolve('ERROR'); }
                    }
                });
            });

            if (token === 'ERROR') return null;
            if (token && token !== 'WAIT') {
                log('[Solver] SOLVED!', 'success');
                return token;
            }
        }
        log('[Solver] Timeout', 'error');
        return null;
    }

    // ═══════════════════════════════════════════════════════
    // GUI
    // ═══════════════════════════════════════════════════════

    let botRunning = false;
    let botMode = sessionStorage.getItem('richup_mode') || null;

    function createGUI() {
        const panel = document.createElement('div');
        panel.id = 'richup-bot-panel';
        panel.className = 'mode-idle';
        panel.innerHTML = `
    <style>
        #richup-bot-panel {
            position: fixed; top: 24px; right: 24px; z-index: 999999;
            font-family: 'Nunito', 'Poppins', system-ui, -apple-system, sans-serif; font-size: 13px;
            color: #e2e4ec; background: #171822;
            border: 1px solid #2a2c3a;
            border-radius: 14px; padding: 18px; min-width: 230px; min-height: 100px;
            box-shadow: 0 16px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05);
            user-select: none; transition: opacity 0.3s;
            box-sizing: border-box; resize: both; overflow: hidden;
            display: flex; flex-direction: column;
        }
        #richup-bot-panel * { box-sizing: border-box; }
        #richup-bot-panel .title {
            font-weight: 800; font-size: 16px; margin-bottom: 14px;
            color: #FFFFFF; letter-spacing: 0.5px;
            display: flex; align-items: center; gap: 8px;
            padding-right: 32px; cursor: move; /* Drag handle */
        }
        #richup-bot-panel .title::before {
            content: ''; display: inline-block; width: 10px; height: 10px;
            border-radius: 50%; transition: all 0.3s ease;
        }
        /* Dynamic Dot Status */
        #richup-bot-panel.mode-idle .title::before { background: #576076; box-shadow: none; }
        #richup-bot-panel.mode-main .title::before { background: #B1E827; box-shadow: 0 0 10px rgba(177, 232, 39, 0.6); }
        #richup-bot-panel.mode-alt .title::before { background: #9D72FF; box-shadow: 0 0 10px rgba(157, 114, 255, 0.6); }

        #richup-bot-panel .body { flex-grow: 1; display: flex; flex-direction: column; }
        #richup-bot-panel .btn-row { display: flex; gap: 10px; margin-bottom: 12px; }
        #richup-bot-panel button {
            flex: 1; padding: 10px 0; border: 1px solid #2a2c3a;
            border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            background: #1e202d; color: #8F94A8;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);
        }
        #richup-bot-panel button:hover:not(:disabled) {
            background: #272a3b; color: #FFFFFF; border-color: #3a3e52;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05);
        }
        #richup-bot-panel button:active:not(:disabled) { transform: translateY(0); box-shadow: none; }
        
        #richup-bot-panel button.active-main {
            background: #B1E827; border-color: #B1E827; color: #171822;
            box-shadow: 0 0 16px rgba(177, 232, 39, 0.2);
        }
        #richup-bot-panel button.active-alt {
            background: #9D72FF; border-color: #9D72FF; color: #FFFFFF;
            box-shadow: 0 0 16px rgba(157, 114, 255, 0.2);
        }
        #richup-bot-panel button.stop {
            background: #FF4757; border-color: #FF4757; color: #FFFFFF;
            font-size: 12px; padding: 8px 0;
            box-shadow: 0 0 12px rgba(255, 71, 87, 0.2);
        }
        #richup-bot-panel button.stop:hover:not(:disabled) {
            background: #FF6B81; border-color: #FF6B81;
        }

        #richup-bot-panel .secondary-btn { font-size: 11px; padding: 8px; background: #1a1c25; color: #6b7280; border-color: #232530; font-weight: 600; }
        #richup-bot-panel .secondary-btn:hover:not(:disabled) { background: #222533; color: #F2F4F8; border-color: #2d303f; }

        #richup-bot-panel .status-row { 
            display: flex; justify-content: space-between; align-items: center; 
            margin-top: auto; font-size: 12px; 
            background: #1e202d; padding: 10px 12px; border-radius: 8px;
            border: 1px solid #232530;
        }
        #richup-bot-panel .status { color: #FFFFFF; font-weight: 600; }
        #richup-bot-panel .turns { color: #8F94A8; font-weight: 700; }

        #richup-bot-panel .bottom-row { 
            display: flex; justify-content: space-between; align-items: center; 
            margin-top: 14px; padding-top: 14px; border-top: 1px solid #2A2C3C; 
        }
        #richup-bot-panel .state {
            font-size: 10px; padding: 4px 8px; border-radius: 4px; background: #212330;
            color: #8F94A8; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;
        }
        /* Dynamic State Colors */
        #richup-bot-panel .state.lobby { background: rgba(255, 165, 2, 0.15); color: #FFA502; border: 1px solid rgba(255, 165, 2, 0.3); }
        #richup-bot-panel .state.game { background: rgba(177, 232, 39, 0.15); color: #B1E827; border: 1px solid rgba(177, 232, 39, 0.3); }
        #richup-bot-panel .state.modal { background: rgba(255, 71, 87, 0.15); color: #FF4757; border: 1px solid rgba(255, 71, 87, 0.3); }
        
        #richup-bot-panel .footer { font-size: 10px; color: #576076; font-weight: 600; }

        #richup-bot-panel .minimize-btn {
            position: absolute; top: 12px; right: 12px; background: none; border: none;
            color: #576076; font-size: 20px; font-weight: 700; cursor: pointer; padding: 0; line-height: 1;
            width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
            border-radius: 6px; transition: background 0.2s, color 0.2s; box-shadow: none;
        }
        #richup-bot-panel .minimize-btn:hover { color: #FFFFFF; background: #272a3b; border: none; transform: none; }
        
        #richup-bot-panel.minimized .title { margin-bottom: 0; }
        #richup-bot-panel.minimized .body { display: none; }
        #richup-bot-panel.minimized { 
            min-width: 150px; padding: 12px 18px; border-radius: 12px; 
            min-height: auto; height: auto !important; width: auto !important; resize: none; 
        }
    </style>
    
    <div class="title">RichUp Bot</div>
    <button class="minimize-btn" id="rb-minimize" title="Minimize/Expand">−</button>
    
    <div class="body">
        <div class="btn-row">
            <button id="rb-main">▶ Main</button>
            <button id="rb-alt">▶ Alt</button>
        </div>
        <div class="btn-row" style="display:none" id="rb-stop-row">
            <button class="stop" id="rb-stop">■ Stop Bot</button>
        </div>
        
        <div class="btn-row" style="margin-top:4px">
            <button id="rb-keepalive" class="secondary-btn">↻ Keep-Alive Tab</button>
            <button id="rb-solver-key" class="secondary-btn">🔑 API Key</button>
        </div>

        <div class="status-row">
            <span id="rb-status" class="status">Ready</span>
            <span id="rb-turns" class="turns">Turns: 0</span>
        </div>
        
        <div class="bottom-row">
            <span id="rb-status-state" class="state">IDLE</span>
            <span class="footer">By Condha</span>
        </div>
    </div>
`;
        document.body.appendChild(panel);

        // Draggable Logic
        let dragging = false, dx, dy;

        panel.addEventListener('mousedown', e => {
            if (!e.target.closest('.title')) return; // Only allow dragging from the title area

            const r = panel.getBoundingClientRect();
            // Switch to absolute positioning relative to top-left to allow free movement
            panel.style.left = r.left + 'px';
            panel.style.top = r.top + 'px';
            panel.style.right = 'auto'; // Prevent stretching
            panel.style.bottom = 'auto';

            dragging = true;
            dx = e.clientX - r.left;
            dy = e.clientY - r.top;
        });

        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            panel.style.left = (e.clientX - dx) + 'px';
            panel.style.top = (e.clientY - dy) + 'px';
        });

        document.addEventListener('mouseup', () => { dragging = false; });

        // Controls
        document.getElementById('rb-minimize').onclick = (e) => {
            panel.classList.toggle('minimized');
            e.target.textContent = panel.classList.contains('minimized') ? '＋' : '−';
        };
        document.getElementById('rb-main').onclick = () => startBot('main');
        document.getElementById('rb-alt').onclick = () => startBot('alt');
        document.getElementById('rb-stop').onclick = () => stopBot();
        document.getElementById('rb-keepalive').onclick = () => {
            const url = win.location.href; // Use window (sandbox) or win? window.location works.
            const u = new URL(url);
            u.searchParams.set('bot_mode', 'keepalive');
            win.open(u.toString(), '_blank');
        };
        document.getElementById('rb-solver-key').onclick = () => {
            const k = prompt('Enter your 2Captcha API Key to automate Cloudflare:', GM_getValue('solver_key', ''));
            if (k !== null) {
                GM_setValue('solver_key', k.trim());
                alert('Saved! Reload the Keep-Alive tab to use it.');
            }
        };

        if (botMode) startBot(botMode);
    }

    function updateTurns(n) {
        const el = document.getElementById('rb-turns');
        if (el) el.innerText = 'Turns: ' + n;
    }

    function updateStatus(text, cls) {
        const el = document.getElementById('rb-status');
        if (el) { el.textContent = text; el.className = 'status' + (cls ? ' ' + cls : ''); }
    }

    function startBot(mode) {
        if (botRunning) return;
        botRunning = true;
        botMode = mode;
        sessionStorage.setItem('richup_mode', mode);

        const mainBtn = document.getElementById('rb-main');
        const altBtn = document.getElementById('rb-alt');
        const stopRow = document.getElementById('rb-stop-row');
        const panel = document.getElementById('richup-bot-panel');

        mainBtn.disabled = true;
        altBtn.disabled = true;

        if (panel) {
            panel.classList.remove('mode-idle', 'mode-main', 'mode-alt');
            panel.classList.add('mode-' + mode);
        }

        if (mode === 'main') {
            mainBtn.classList.add('active-main');
            updateTurns(Number(localStorage.getItem('main_turns')) || 0);
            runMain();
        } else {
            altBtn.classList.add('active-alt');
            const ALT_ID = sessionStorage.getItem('alt_id') || (() => {
                const id = 'alt_' + Math.random().toString(36).slice(2, 6);
                sessionStorage.setItem('alt_id', id);
                return id;
            })();
            updateTurns(Number(sessionStorage.getItem(ALT_ID + '_turns')) || 0);
            runAlt();
        }
        stopRow.style.display = 'flex';
        updateStatus('Running ' + mode.toUpperCase(), 'running');
    }

    function stopBot() {
        botRunning = false; sessionStorage.removeItem('richup_mode');
        const mainBtn = document.getElementById('rb-main');
        const altBtn = document.getElementById('rb-alt');
        const stopRow = document.getElementById('rb-stop-row');
        const panel = document.getElementById('richup-bot-panel');

        mainBtn.disabled = false; altBtn.disabled = false;
        mainBtn.classList.remove('active-main');
        altBtn.classList.remove('active-alt');

        if (panel) {
            panel.classList.remove('mode-idle', 'mode-main', 'mode-alt');
            panel.classList.add('mode-idle');
        }

        stopRow.style.display = 'none';
        updateStatus('Stopped');
        updateStateDisplay('IDLE');
    }

    // ═══════════════════════════════════════════════════════
    // MAIN BOT LOOP
    // ═══════════════════════════════════════════════════════

    async function runMain() {
        let turnCount = Number(localStorage.getItem('main_turns')) || 0;
        let games = Number(localStorage.getItem('main_games')) || 0;
        let lobbyTime = null, waiting = false, swatchAttempt = 0;

        const logMain = msg => log(`[MAIN] ${msg}`);
        const clickBtn = (match, label) => {
            const btn = getBtn(match);
            if (btn) { doClick(btn); logMain(label); return true; }
            return false;
        };

        logMain('Started');

        while (botRunning) {
            try {
                // MODAL CHECK
                if (isModalOpen()) {
                    updateStateDisplay('MODAL');
                    logMain('Modal detected (How to play?), waiting...');
                    await sleep(2000);
                    continue;
                }

                // 1. Play Again
                if (clickBtn('another game', 'Another game')) {
                    games++; localStorage.setItem('main_games', String(games));
                    turnCount = 0; localStorage.setItem('main_turns', '0');
                    updateTurns(0);
                    waiting = false; lobbyTime = null; swatchAttempt = 0;
                    logMain('Game ' + games + ' done');
                    await sleep(800); continue;
                }

                // 2. Start Game (Host) - Check this BEFORE color selection to prioritize starting
                const startBtn = getBtn(t => t.includes('start game') || t === 'start');
                if (startBtn) {
                    updateStateDisplay('LOBBY');
                    if (!waiting) { waiting = true; lobbyTime = Date.now(); logMain('Waiting for players...'); }
                    // Wait a bit to let others join, but start if ready
                    if (Date.now() - lobbyTime >= 4000) {
                        doClick(startBtn); logMain('Starting game');
                        waiting = false; lobbyTime = null;
                        turnCount = 0; updateTurns(0);
                        await sleep(1500);
                    }
                    await sleep(CHECK_MS); continue;
                } else {
                    waiting = false;
                }

                // 3. Color Selection
                if (onColorScreen()) {
                    updateStateDisplay('LOBBY');
                    const swatches = findSwatches();
                    if (swatches.length >= 4) {
                        const idx = swatchAttempt % swatches.length;
                        doClick(swatches[idx]);
                        await sleep(800);
                        if (clickBtn(t => t.includes('join game'), 'Join Game')) {
                            logMain('Joining game, waiting for lobby...');
                            for (let w = 0; w < 15; w++) {
                                await sleep(500);
                                if (!onColorScreen()) break;
                            }
                            swatchAttempt++;
                        }
                    }
                    await sleep(CHECK_MS); continue;
                }

                // 4. Lobby Check (Passive)
                // If we are in lobby but not host (or host but start hidden), we must NOT fall through to game
                if (isInLobby()) {
                    updateStateDisplay('LOBBY');
                    // logMain('In Lobby, waiting...');
                    await sleep(CHECK_MS); continue;
                }

                // AFK VOTEKICK FAILSAFE
                const lastAction = Number(localStorage.getItem('rb_last_action')) || Date.now();
                if (Date.now() - lastAction > 35000) {
                    logMain('AFK Failsafe triggered: No actions in 35s. Kicking inactive players...');

                    // Click Vote Kick button
                    const voteKickBtn = getBtn(t => t.includes('votekick'));
                    if (voteKickBtn) {
                        doClick(voteKickBtn);
                        await sleep(1000); // wait for modal

                        // Find all small kick buttons in the modal (buttons with SVG or "kick" aria labels)
                        const kickButtons = [...document.querySelectorAll('button')].filter(b => {
                            if (b.closest('#richup-bot-panel')) return false;

                            const html = b.innerHTML.toLowerCase();
                            // Filter out "Help" and "Sound" buttons which also have SVGs
                            if (html.includes('question') || html.includes('volume') || html.includes('sound') || html.includes('speaker') || html.includes('discord')) return false;

                            const t = norm(b.textContent + ' ' + (b.getAttribute('aria-label') || ''));
                            // Looking for small X buttons or explicit kick attributes
                            return t.includes('kick') || t.includes('remove') || (b.querySelector('svg') !== null);
                        });

                        // Ignore buttons that are large or have general text to avoid closing the modal
                        for (const b of kickButtons) {
                            const rect = b.getBoundingClientRect();
                            if (rect.width > 0 && rect.width < 50 && rect.height > 0 && rect.height < 50) {
                                doClick(b);
                                await sleep(300);
                            }
                        }
                    }
                    localStorage.setItem('rb_last_action', Date.now()); // Reset timer
                }

                // 5. Game Loop
                updateStateDisplay('GAME');
                let acted = false;

                // Helper to record action
                const recordAction = () => localStorage.setItem('rb_last_action', Date.now());

                // Roll
                if (!acted && clickBtn(t => t === 'roll the dice' || t === 'roll again', 'Roll')) {
                    turnCount++; localStorage.setItem('main_turns', String(turnCount));
                    updateTurns(turnCount);
                    recordAction();
                    logMain('Turn ' + turnCount); acted = true; await sleep(800);
                }
                // Transactions
                if (!acted && clickBtn(t => t === 'buy' || t.startsWith('buy '), 'Buy')) { recordAction(); acted = true; await sleep(500); }
                if (!acted && clickBtn('end turn', 'End turn')) { recordAction(); acted = true; await sleep(500); }
                if (!acted && clickBtn(t => t === 'pay' || t.startsWith('pay '), 'Pay')) { recordAction(); acted = true; await sleep(500); }
                if (!acted && clickBtn(t => t === 'ok' || t === 'okay' || t === 'got it', 'OK')) { recordAction(); acted = true; await sleep(500); }

                await sleep(CHECK_MS);

            } catch (e) {
                log(`[MAIN] Error: ${e.message}`, 'error');
                await sleep(CHECK_MS);
            }
        }
    }

    // ═══════════════════════════════════════════════════════
    // ALT BOT LOOP
    // ═══════════════════════════════════════════════════════

    async function runAlt() {
        const ALT_ID = sessionStorage.getItem('alt_id') || (() => {
            const id = 'alt_' + Math.random().toString(36).slice(2, 6);
            sessionStorage.setItem('alt_id', id);
            return id;
        })();

        let turnCount = Number(sessionStorage.getItem(ALT_ID + '_turns')) || 0;
        let swatchAttempt = 0;

        // auto-offset not strictly needed for logic but good for color variation
        let hh = 0; for (let i = 0; i < ALT_ID.length; i++) hh = ((hh << 5) - hh) + ALT_ID.charCodeAt(i);
        const autoOffset = Math.abs(hh);

        const logAlt = msg => log(`[${ALT_ID}] ${msg}`);
        const clickBtn = (match, label) => {
            const btn = getBtn(match);
            if (btn) { doClick(btn); logAlt(label); return true; }
            return false;
        };

        logAlt('Started');

        while (botRunning) {
            try {
                if (isModalOpen()) {
                    updateStateDisplay('MODAL');
                    await sleep(2000);
                    continue;
                }

                if (clickBtn('another game', 'Another game')) {
                    turnCount = 0; sessionStorage.setItem(ALT_ID + '_turns', '0');
                    updateTurns(0);
                    await sleep(1500); continue;
                }

                // Bankruptcy Logic
                if (turnCount > BANKRUPT_AFTER) {

                    // 1. Initial BANKRUPT Click
                    const btns = [...document.querySelectorAll('button')];
                    let initialBtn = btns.find(b => {
                        const t = norm(b.textContent);
                        return t === 'bankrupt' || t === 'declare bankruptcy';
                    });

                    if (initialBtn) {
                        doClick(initialBtn);
                        logAlt('Bankrupting... (Initial click)');
                        await sleep(1500); // Wait for modal to appear

                        // 2. CONFIRM in MODAL
                        // Search for buttons again to find the one in the modal
                        const newBtns = [...document.querySelectorAll('button')];
                        // Find a button with 'Bankrupt' or 'Confirm' text
                        // We search from the END (Array.reverse) because modal buttons are usually appended last
                        const confirmBtn = newBtns.reverse().find(b => {
                            const t = norm(b.textContent);
                            return t === 'bankrupt' || t === 'confirm' || t === 'yes';
                        });

                        if (confirmBtn) {
                            doClick(confirmBtn);
                            logAlt('Confirmed Bankruptcy.');
                        } else {
                            logAlt('No confirmation button found?');
                        }

                        await sleep(3000);
                        turnCount = 0; sessionStorage.setItem(ALT_ID + '_turns', '0');
                        updateTurns(0);
                    }
                }

                // 3. Start Game (if host)
                // Using .includes() matching to be safe
                const startBtn = getBtn(t => t.includes('start game') || t === 'start');
                if (startBtn) {
                    // If we are host, start the game after a short delay
                    // Alts usually aren't hosts, but if they are, treat them like Main
                    doClick(startBtn); logAlt('Starting game (host)');
                    turnCount = 0; updateTurns(0);
                    await sleep(2000);
                }

                if (onColorScreen()) {
                    updateStateDisplay('LOBBY');
                    const swatches = findSwatches();
                    if (swatches.length >= 4) {
                        const idx = (autoOffset + swatchAttempt) % swatches.length;
                        doClick(swatches[idx]);
                        await sleep(1000);
                        if (clickBtn(t => t.includes('join game'), 'Join Game')) {
                            logAlt('Joined game, waiting for lobby...');
                            for (let w = 0; w < 15; w++) {
                                await sleep(500);
                                if (!onColorScreen()) break;
                            }
                            swatchAttempt++;
                        }
                    }
                    await sleep(CHECK_MS); continue;
                }

                if (isInLobby()) {
                    updateStateDisplay('LOBBY');
                    await sleep(CHECK_MS); continue;
                }

                // AFK VOTEKICK FAILSAFE (Alt version)
                const lastAction = Number(localStorage.getItem('rb_last_action')) || Date.now();
                if (Date.now() - lastAction > 35000) {
                    logAlt('AFK Failsafe triggered: No actions in 35s. Kicking inactive players...');

                    const voteKickBtn = getBtn(t => t.includes('votekick'));
                    if (voteKickBtn) {
                        doClick(voteKickBtn);
                        await sleep(1000);

                        const kickButtons = [...document.querySelectorAll('button')].filter(b => {
                            if (b.closest('#richup-bot-panel')) return false;

                            const html = b.innerHTML.toLowerCase();
                            // Filter out "Help" and "Sound" buttons which also have SVGs
                            if (html.includes('question') || html.includes('volume') || html.includes('sound') || html.includes('speaker') || html.includes('discord')) return false;

                            const t = norm(b.textContent + ' ' + (b.getAttribute('aria-label') || ''));
                            return t.includes('kick') || t.includes('remove') || (b.querySelector('svg') !== null);
                        });

                        for (const b of kickButtons) {
                            const rect = b.getBoundingClientRect();
                            if (rect.width > 0 && rect.width < 50 && rect.height > 0 && rect.height < 50) {
                                doClick(b);
                                await sleep(300);
                            }
                        }
                    }
                    localStorage.setItem('rb_last_action', Date.now());
                }

                updateStateDisplay('GAME');
                let acted = false;

                const recordAction = () => localStorage.setItem('rb_last_action', Date.now());

                if (!acted && clickBtn(t => t === 'roll the dice' || t === 'roll again', 'Roll')) {
                    turnCount++;
                    sessionStorage.setItem(ALT_ID + '_turns', String(turnCount));
                    updateTurns(turnCount);
                    recordAction();
                    logAlt('Turn ' + turnCount + '/' + BANKRUPT_AFTER);
                    acted = true; await sleep(800);
                }
                if (!acted && clickBtn(t => t === 'buy' || t.startsWith('buy '), 'Buy')) { recordAction(); acted = true; await sleep(500); }
                if (!acted && clickBtn('end turn', 'End turn')) { recordAction(); acted = true; await sleep(500); }
                if (!acted && clickBtn(t => t === 'pay' || t.startsWith('pay '), 'Pay')) { recordAction(); acted = true; await sleep(500); }
                if (!acted && clickBtn(t => t === 'ok' || t === 'okay' || t === 'got it', 'OK')) { recordAction(); acted = true; await sleep(500); }

                await sleep(CHECK_MS);

            } catch (e) {
                log(`[${ALT_ID}] Error: ${e.message}`, 'error');
                await sleep(CHECK_MS);
            }
        }
    }

    setTimeout(createGUI, 1500);

})();
