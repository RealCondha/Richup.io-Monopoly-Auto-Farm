// ==UserScript==
// @name         RichUp Bot
// @namespace    richup-bot
// @version      2.8.0-stable
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

    function log(msg, type = 'info') {
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
            const rect = btn.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            if (BLACKLIST.some(b => tl.includes(b))) continue;

            const isMatch = (typeof match === 'string' && tl === match.toLowerCase()) ||
                (typeof match === 'function' && match(tl));

            if (isMatch) {
                return btn;
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
            if (r.width < 15 || r.width > 90 || r.height < 15 || r.height > 90) return false;
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
        panel.innerHTML = `
    <style>
        #richup-bot-panel {
            position: fixed; top: 18px; right: 18px; z-index: 999999;
            font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px;
            color: #e0e0e0; background: rgba(22, 19, 32, 0.85);
            backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(139, 92, 246, 0.25);
            border-radius: 16px; padding: 14px 16px; min-width: 190px;
            box-shadow: 0 4px 30px rgba(0,0,0,0.5), 0 0 15px rgba(139, 92, 246, 0.1);
            user-select: none; cursor: move; transition: opacity 0.3s;
            box-sizing: border-box;
        }
        #richup-bot-panel * { box-sizing: border-box; }
        #richup-bot-panel .title {
            font-weight: 800; font-size: 15px; margin-bottom: 10px;
            background: linear-gradient(90deg, #e9d5ff, #c084fc); -webkit-background-clip: text; color: transparent;
            text-shadow: 0 2px 10px rgba(192, 132, 252, 0.2); letter-spacing: 0.5px;
        }
        #richup-bot-panel .btn-row { display: flex; gap: 8px; margin-bottom: 8px; }
        #richup-bot-panel button {
            flex: 1; padding: 7px 0; border: 1px solid rgba(255,255,255,0.08);
            border-radius: 10px; font-size: 12px; font-weight: 700; cursor: pointer;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            background: rgba(255,255,255,0.04); color: #ccc;
        }
        #richup-bot-panel button:hover {
            background: rgba(255,255,255,0.1); color: #fff; border-color: rgba(255,255,255,0.2);
            transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }
        #richup-bot-panel button:active { transform: translateY(0); }
        
        #richup-bot-panel button.active-main {
            background: linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(20, 83, 45, 0.3));
            border-color: rgba(74, 222, 128, 0.4); color: #86efac;
            box-shadow: 0 0 12px rgba(74, 222, 128, 0.2);
        }
        #richup-bot-panel button.active-alt {
            background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(76, 29, 149, 0.3));
            border-color: rgba(167, 139, 250, 0.4); color: #c4b5fd;
            box-shadow: 0 0 12px rgba(167, 139, 250, 0.2);
        }
        #richup-bot-panel button.stop {
            background: rgba(239, 68, 68, 0.2); border-color: rgba(248, 113, 113, 0.4); color: #fca5a5;
            font-size: 11px; padding: 5px 0;
        }

        #richup-bot-panel .status-row { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 11px; }
        #richup-bot-panel .status { color: #94a3b8; font-weight: 500; }
        #richup-bot-panel .turns { color: #cbd5e1; font-family: 'Consolas', monospace; font-size: 11px; }

        #richup-bot-panel .bottom-row { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); }
        #richup-bot-panel .state {
            font-size: 9px; padding: 3px 6px; border-radius: 6px; background: #0f172a;
            color: #64748b; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;
        }
        /* Dynamic State Colors */
        #richup-bot-panel .state.lobby { background: rgba(234, 179, 8, 0.15); color: #fde047; box-shadow: 0 0 8px rgba(234, 179, 8, 0.1); }
        #richup-bot-panel .state.game { background: rgba(34, 197, 94, 0.15); color: #86efac; box-shadow: 0 0 8px rgba(34, 197, 94, 0.1); }
        #richup-bot-panel .state.modal { background: rgba(239, 68, 68, 0.15); color: #fca5a5; box-shadow: 0 0 8px rgba(239, 68, 68, 0.1); }
        
        #richup-bot-panel .footer { font-size: 9px; color: #64748b; font-style: italic; font-family: 'Consolas', monospace; opacity: 0.8; }

        #richup-bot-panel .minimize-btn {
            position: absolute; top: 12px; right: 14px; background: none; border: none;
            color: #64748b; font-size: 18px; cursor: pointer; padding: 0; line-height: 1; transition: color 0.2s;
        }
        #richup-bot-panel .minimize-btn:hover { color: #fff; }
        #richup-bot-panel.minimized .body { display: none; }
        #richup-bot-panel.minimized { min-width: auto; padding: 10px 14px; border-radius: 12px; }
    </style>
    
    <div class="title">RichUp Bot</div>
    <span class="minimize-btn" id="rb-minimize">−</span>
    
    <div class="body">
        <div class="btn-row">
            <button id="rb-main">▶ Main</button>
            <button id="rb-alt">▶ Alt</button>
        </div>
        <div class="btn-row" style="display:none" id="rb-stop-row">
            <button class="stop" id="rb-stop">■ Stop Bot</button>
        </div>
        
        <div class="btn-row" style="margin-top:8px">
            <button id="rb-keepalive" style="font-size:10px;padding:4px;background:rgba(255,255,255,0.03);border-color:rgba(255,255,255,0.05);color:#777">↻ Keep-Alive Tab</button>
            <button id="rb-solver-key" style="font-size:10px;padding:4px;background:rgba(255,255,255,0.03);border-color:rgba(255,255,255,0.05);color:#777">🔑 Set API Key</button>
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

        // Draggable Logic (Fixed stretching bug)
        let dragging = false, dx, dy;

        panel.addEventListener('mousedown', e => {
            if (e.target.tagName === 'BUTTON' || e.target.id === 'rb-minimize') return;

            const r = panel.getBoundingClientRect();
            // Switch to absolute positioning relative to top-left to allow free movement
            panel.style.left = r.left + 'px';
            panel.style.top = r.top + 'px';
            panel.style.right = 'auto'; // Prevent stretching
            panel.style.bottom = 'auto';
            // Removed width fixing to allow auto-sizing and prevent growth bug

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
        document.getElementById('rb-minimize').onclick = () => panel.classList.toggle('minimized');
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

        mainBtn.disabled = true;
        altBtn.disabled = true;

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
        mainBtn.disabled = false; altBtn.disabled = false;
        mainBtn.classList.remove('active-main');
        altBtn.classList.remove('active-alt');
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
                            await sleep(2000);
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

                // 5. Game Loop
                updateStateDisplay('GAME');
                let acted = false;

                // Roll
                if (!acted && clickBtn(t => t === 'roll the dice' || t === 'roll again', 'Roll')) {
                    turnCount++; localStorage.setItem('main_turns', String(turnCount));
                    updateTurns(turnCount);
                    logMain('Turn ' + turnCount); acted = true; await sleep(800);
                }
                // Transactions
                if (!acted && clickBtn(t => t === 'buy' || t.startsWith('buy '), 'Buy')) { acted = true; await sleep(500); }
                if (!acted && clickBtn('end turn', 'End turn')) { acted = true; await sleep(500); }
                if (!acted && clickBtn(t => t === 'pay' || t.startsWith('pay '), 'Pay')) { acted = true; await sleep(500); }
                if (!acted && clickBtn(t => t === 'ok' || t === 'okay' || t === 'got it', 'OK')) { acted = true; await sleep(500); }

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
                            // Wait for transition to prevent double-click
                            for (let w = 0; w < 10; w++) {
                                await sleep(500);
                                if (isInLobby()) break;
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

                updateStateDisplay('GAME');
                let acted = false;
                if (!acted && clickBtn(t => t === 'roll the dice' || t === 'roll again', 'Roll')) {
                    turnCount++;
                    sessionStorage.setItem(ALT_ID + '_turns', String(turnCount));
                    updateTurns(turnCount);
                    logAlt('Turn ' + turnCount + '/' + BANKRUPT_AFTER);
                    acted = true; await sleep(800);
                }
                if (!acted && clickBtn(t => t === 'buy' || t.startsWith('buy '), 'Buy')) { acted = true; await sleep(500); }
                if (!acted && clickBtn('end turn', 'End turn')) { acted = true; await sleep(500); }
                if (!acted && clickBtn(t => t === 'pay' || t.startsWith('pay '), 'Pay')) { acted = true; await sleep(500); }
                if (!acted && clickBtn(t => t === 'ok' || t === 'okay' || t === 'got it', 'OK')) { acted = true; await sleep(500); }

                await sleep(CHECK_MS);

            } catch (e) {
                log(`[${ALT_ID}] Error: ${e.message}`, 'error');
                await sleep(CHECK_MS);
            }
        }
    }

    setTimeout(createGUI, 1500);

})();
