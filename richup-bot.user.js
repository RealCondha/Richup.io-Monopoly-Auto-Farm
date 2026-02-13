// ==UserScript==
// @name         RichUp Bot
// @namespace    richup-bot
// @version      2.1.0
// @description  Auto-farm RichUp.io — pick Main or Alt mode per tab
// @match        https://richup.io/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════
    // CONFIG
    // ═══════════════════════════════════════════════════════

    const CHECK_MS = 700;
    const LOBBY_WAIT = 6000;
    const BANKRUPT_AFTER = 70;

    // ═══════════════════════════════════════════════════════
    // SHARED UTILS
    // ═══════════════════════════════════════════════════════

    const sleep = ms => new Promise(r => setTimeout(r, ms + Math.random() * 200));

    const BLACKLIST = [
        'share', 'copy', 'invite', 'sound', 'spectate', 'return to lobby',
        'go to lobby', 'get more', 'change appearance', 'login', 'sign up',
        'see all', 'private room', 'log in', 'settings', 'appearance'
    ];

    function norm(s) { return s.trim().replace(/\s+/g, ' ').toLowerCase(); }

    function doClick(el) {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 };
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

        let node = el;
        for (let d = 0; d < 8 && node; d++) {
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
        for (const k of Object.keys(el)) {
            if (k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')) {
                const p = el[k]; if (!p) continue;
                let found = false;
                if (typeof p.onClick === 'function') { try { p.onClick(fe); found = true; } catch (e) { } }
                if (typeof p.onMouseDown === 'function') { try { p.onMouseDown({ ...fe, type: 'mousedown' }); found = true; } catch (e) { } }
                if (typeof p.onPointerDown === 'function') { try { p.onPointerDown({ ...fe, type: 'pointerdown' }); found = true; } catch (e) { } }
                if (found) return true;
            }
            if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) {
                let f = el[k], d = 0;
                while (f && d < 15) {
                    const mp = f.memoizedProps;
                    if (mp) {
                        if (typeof mp.onClick === 'function') { try { mp.onClick(fe); } catch (e) { } return true; }
                        if (typeof mp.onMouseDown === 'function') { try { mp.onMouseDown({ ...fe, type: 'mousedown' }); } catch (e) { } return true; }
                        if (typeof mp.onPointerDown === 'function') { try { mp.onPointerDown({ ...fe, type: 'pointerdown' }); } catch (e) { } return true; }
                    }
                    f = f.return; d++;
                }
            }
        }
        return false;
    }

    function getBtn(match) {
        for (const btn of document.querySelectorAll('button')) {
            if (btn.disabled) continue;
            const tl = norm(btn.textContent);
            const rect = btn.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            if (BLACKLIST.some(b => tl.includes(b))) continue;
            if (typeof match === 'string' && tl === match.toLowerCase()) return btn;
            if (typeof match === 'function' && match(tl)) return btn;
        }
        return null;
    }

    // disconnect detection — disabled until we can identify exact overlay element
    function isDisconnected() {
        return false;
    }

    // swatch detection
    function findSwatches() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let textNode;
        while (textNode = walker.nextNode()) {
            if (textNode.textContent.toLowerCase().includes('select your')) {
                let container = textNode.parentElement;
                for (let lvl = 0; lvl < 6 && container; lvl++) {
                    const sw = filterSwatchButtons(container.querySelectorAll('button:not([disabled])'));
                    if (sw.length >= 4) return sw;
                    container = container.parentElement;
                }
                break;
            }
        }
        return filterSwatchButtons(document.querySelectorAll('button:not([disabled])'), true);
    }

    function filterSwatchButtons(buttons, requireColor) {
        return [...buttons].filter(btn => {
            const r = btn.getBoundingClientRect();
            if (r.width < 15 || r.width > 90 || r.height < 15 || r.height > 90) return false;
            if (!btn.querySelector('svg')) return false;
            if (btn.textContent.trim().length > 5) return false;
            if (requireColor) {
                const c = btn.style.color;
                if (!c || !c.startsWith('rgb')) return false;
            }
            return true;
        });
    }

    function onColorScreen() {
        const joinBtn = getBtn('join game') || getBtn(t => t.includes('join game'));
        return !!joinBtn;
    }

    function onColorScreenStrict() {
        const joinBtn = getBtn('join game') || getBtn(t => t.includes('join game'));
        if (!joinBtn) return false;
        const body = document.body.innerText.toLowerCase();
        return body.includes('select your') && body.includes('appearance');
    }

    // ═══════════════════════════════════════════════════════
    // GUI
    // ═══════════════════════════════════════════════════════

    let botRunning = false;
    let botMode = sessionStorage.getItem('richup_mode') || null; // 'main' or 'alt'

    function createGUI() {
        const panel = document.createElement('div');
        panel.id = 'richup-bot-panel';
        panel.innerHTML = `
            <style>
                #richup-bot-panel {
                    position: fixed;
                    top: 12px;
                    right: 12px;
                    z-index: 999999;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                    font-size: 13px;
                    color: #e0e0e0;
                    background: rgba(20, 20, 30, 0.92);
                    backdrop-filter: blur(12px);
                    border: 1px solid rgba(120, 80, 255, 0.3);
                    border-radius: 12px;
                    padding: 14px 16px;
                    min-width: 180px;
                    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
                    user-select: none;
                    cursor: move;
                }
                #richup-bot-panel .title {
                    font-weight: 700;
                    font-size: 14px;
                    margin-bottom: 10px;
                    color: #c4adff;
                    letter-spacing: 0.5px;
                }
                #richup-bot-panel .btn-row {
                    display: flex;
                    gap: 6px;
                    margin-bottom: 8px;
                }
                #richup-bot-panel button {
                    flex: 1;
                    padding: 7px 0;
                    border: 1px solid rgba(255,255,255,0.12);
                    border-radius: 8px;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.15s;
                    background: rgba(255,255,255,0.06);
                    color: #ccc;
                }
                #richup-bot-panel button:hover {
                    background: rgba(255,255,255,0.12);
                    color: #fff;
                }
                #richup-bot-panel button.active-main {
                    background: rgba(80, 200, 120, 0.25);
                    border-color: rgba(80, 200, 120, 0.5);
                    color: #6fdc8c;
                }
                #richup-bot-panel button.active-alt {
                    background: rgba(120, 80, 255, 0.25);
                    border-color: rgba(120, 80, 255, 0.5);
                    color: #a78bfa;
                }
                #richup-bot-panel button.stop {
                    background: rgba(255, 70, 70, 0.2);
                    border-color: rgba(255, 70, 70, 0.4);
                    color: #ff6b6b;
                }
                #richup-bot-panel .status {
                    font-size: 11px;
                    color: #888;
                    margin-top: 4px;
                }
                #richup-bot-panel .status.running { color: #6fdc8c; }
                #richup-bot-panel .status.disconnected { color: #ff6b6b; }
                #richup-bot-panel .minimize-btn {
                    position: absolute;
                    top: 6px;
                    right: 10px;
                    background: none;
                    border: none !important;
                    color: #666;
                    font-size: 16px;
                    cursor: pointer;
                    padding: 0;
                    line-height: 1;
                    flex: none !important;
                    width: auto !important;
                }
                #richup-bot-panel .minimize-btn:hover { color: #aaa; }
                #richup-bot-panel.minimized .body { display: none; }
                #richup-bot-panel.minimized { min-width: auto; padding: 8px 12px; }
            </style>
            <div class="title">RichUp Bot</div>
            <span class="minimize-btn" id="rb-minimize">—</span>
            <div class="body">
                <div class="btn-row">
                    <button id="rb-main">▶ Main</button>
                    <button id="rb-alt">▶ Alt</button>
                </div>
                <div class="btn-row" style="display:none" id="rb-stop-row">
                    <button class="stop" id="rb-stop">■ Stop</button>
                </div>
                <div class="status" id="rb-status">Not running</div>
            </div>
        `;
        document.body.appendChild(panel);

        // dragging
        let dragging = false, dx, dy;
        panel.addEventListener('mousedown', e => {
            if (e.target.tagName === 'BUTTON') return;
            dragging = true;
            dx = e.clientX - panel.offsetLeft;
            dy = e.clientY - panel.offsetTop;
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            panel.style.left = (e.clientX - dx) + 'px';
            panel.style.top = (e.clientY - dy) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { dragging = false; });

        // minimize
        document.getElementById('rb-minimize').onclick = () => {
            panel.classList.toggle('minimized');
        };

        // buttons
        document.getElementById('rb-main').onclick = () => startBot('main');
        document.getElementById('rb-alt').onclick = () => startBot('alt');
        document.getElementById('rb-stop').onclick = () => stopBot();

        // auto-restart if mode was saved (page reload recovery)
        if (botMode) {
            startBot(botMode);
        }
    }

    function updateStatus(text, cls) {
        const el = document.getElementById('rb-status');
        if (el) { el.textContent = text; el.className = 'status' + (cls ? ' ' + cls : ''); }
    }

    function startBot(mode) {
        if (botRunning) return;
        botMode = mode;
        botRunning = true;
        sessionStorage.setItem('richup_mode', mode);

        // update GUI
        const mainBtn = document.getElementById('rb-main');
        const altBtn = document.getElementById('rb-alt');
        const stopRow = document.getElementById('rb-stop-row');
        mainBtn.disabled = true; altBtn.disabled = true;
        if (mode === 'main') mainBtn.classList.add('active-main');
        else altBtn.classList.add('active-alt');
        stopRow.style.display = 'flex';
        updateStatus('Running as ' + mode.toUpperCase(), 'running');

        if (mode === 'main') runMain();
        else runAlt();
    }

    function stopBot() {
        botRunning = false;
        sessionStorage.removeItem('richup_mode');
        const mainBtn = document.getElementById('rb-main');
        const altBtn = document.getElementById('rb-alt');
        const stopRow = document.getElementById('rb-stop-row');
        mainBtn.disabled = false; altBtn.disabled = false;
        mainBtn.classList.remove('active-main');
        altBtn.classList.remove('active-alt');
        stopRow.style.display = 'none';
        updateStatus('Stopped');
        document.title = 'Richup.io';
    }

    // ═══════════════════════════════════════════════════════
    // MAIN BOT
    // ═══════════════════════════════════════════════════════

    async function runMain() {
        let turnCount = Number(localStorage.getItem('main_turns')) || 0;
        let games = Number(localStorage.getItem('main_games')) || 0;
        let lobbyTime = null, waiting = false, idleCount = 0, swatchAttempt = 0;
        let wasDisconnected = false;

        const log = msg => console.log('[MAIN] ' + msg);
        const clickBtn = (match, label) => {
            const btn = getBtn(match);
            if (btn) { doClick(btn); log(label); idleCount = 0; return true; }
            return false;
        };

        sessionStorage.setItem('room_url', location.href);
        log('Running | games: ' + games + ' | turns: ' + turnCount);

        while (botRunning) {
            try {
                // disconnect detection
                if (isDisconnected()) {
                    if (!wasDisconnected) {
                        document.title = '[!] DISCONNECTED';
                        updateStatus('Disconnected — verify in new tab', 'disconnected');
                        log('Connection lost — paused');
                        wasDisconnected = true;
                    }
                    await sleep(3000);
                    if (!isDisconnected()) {
                        document.title = 'Richup.io';
                        updateStatus('Running as MAIN', 'running');
                        log('Reconnected');
                        wasDisconnected = false;
                    }
                    continue;
                }
                if (wasDisconnected) {
                    document.title = 'Richup.io';
                    updateStatus('Running as MAIN', 'running');
                    wasDisconnected = false;
                }

                if (clickBtn('another game', 'Another game')) {
                    games++; localStorage.setItem('main_games', String(games));
                    turnCount = 0; localStorage.setItem('main_turns', '0');
                    waiting = false; lobbyTime = null; swatchAttempt = 0;
                    updateStatus('Game ' + games + ' | MAIN', 'running');
                    await sleep(800); continue;
                }

                if (onColorScreen()) {
                    const swatches = findSwatches();
                    if (swatches.length >= 4) {
                        const idx = swatchAttempt % swatches.length;
                        doClick(swatches[idx]);
                        await sleep(800);
                        const joinBtn = getBtn('join game') || getBtn(t => t.includes('join game'));
                        if (joinBtn) {
                            doClick(joinBtn);
                            await sleep(2000);
                            if (!onColorScreen()) {
                                log('Joined'); swatchAttempt = 0;
                            } else {
                                swatchAttempt++;
                                await sleep(3000);
                            }
                        }
                    }
                    await sleep(CHECK_MS); continue;
                }

                const startBtn = getBtn(t => t === 'start game' || t === 'start');
                if (startBtn) {
                    if (!waiting) { waiting = true; lobbyTime = Date.now(); log('Lobby'); }
                    if (Date.now() - lobbyTime >= LOBBY_WAIT) {
                        doClick(startBtn); log('Started game');
                        waiting = false; lobbyTime = null; turnCount = 0;
                        await sleep(1500);
                    }
                    await sleep(CHECK_MS); continue;
                } else { waiting = false; }

                let acted = false;
                if (!acted && clickBtn(t => t === 'roll the dice' || t === 'roll again', 'Roll')) {
                    turnCount++; localStorage.setItem('main_turns', String(turnCount));
                    acted = true; await sleep(800);
                }
                if (!acted && clickBtn(t => t === 'buy' || t.startsWith('buy '), 'Buy')) { acted = true; await sleep(500); }
                if (!acted && clickBtn('end turn', 'End turn')) { acted = true; await sleep(500); }
                if (!acted && clickBtn(t => t === 'pay' || t.startsWith('pay '), 'Pay')) { acted = true; await sleep(500); }
                if (!acted && clickBtn(t => t === 'ok' || t === 'okay' || t === 'got it', 'OK')) { acted = true; await sleep(500); }

                if (!acted) { idleCount++; }
                await sleep(CHECK_MS);
            } catch (e) { console.error('[MAIN]', e); await sleep(CHECK_MS); }
        }
    }

    // ═══════════════════════════════════════════════════════
    // ALT BOT
    // ═══════════════════════════════════════════════════════

    async function runAlt() {
        const ALT_ID = sessionStorage.getItem('alt_id') || (() => {
            const id = 'alt_' + Math.random().toString(36).slice(2, 6);
            sessionStorage.setItem('alt_id', id);
            return id;
        })();

        let turnCount = Number(sessionStorage.getItem(ALT_ID + '_turns')) || 0;
        let savedColorIdx = sessionStorage.getItem(ALT_ID + '_color') !== null
            ? Number(sessionStorage.getItem(ALT_ID + '_color')) : null;
        let bankruptTries = 0, swatchAttempt = 0, lobbyTime = null, idleCount = 0;
        let wasDisconnected = false;

        let hh = 0;
        for (let i = 0; i < ALT_ID.length; i++) hh = ((hh << 5) - hh) + ALT_ID.charCodeAt(i);
        const autoOffset = Math.abs(hh);

        const log = msg => console.log(`[${ALT_ID}] ${msg}`);
        const clickBtn = (match, label) => {
            const btn = getBtn(match);
            if (btn) { doClick(btn); log(label); idleCount = 0; return true; }
            return false;
        };

        // identity persistence
        function captureIdentity() {
            const snap = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k.startsWith('alt_') || k.startsWith('main_')) continue;
                snap[k] = localStorage.getItem(k);
            }
            sessionStorage.setItem(ALT_ID + '_identity', JSON.stringify(snap));
        }
        function restoreIdentity() {
            const s = sessionStorage.getItem(ALT_ID + '_identity');
            if (!s) return;
            const snap = JSON.parse(s);
            for (const [k, v] of Object.entries(snap)) localStorage.setItem(k, v);
        }

        // color pick + join
        async function pickAndJoin() {
            const swatches = findSwatches();
            if (swatches.length < 4) return false;
            let idx;
            if (savedColorIdx !== null && swatchAttempt === 0) idx = savedColorIdx % swatches.length;
            else idx = (autoOffset + swatchAttempt) % swatches.length;

            doClick(swatches[idx]);
            await sleep(1200);
            const joinBtn = getBtn('join game') || getBtn(t => t.includes('join game'));
            if (!joinBtn) return false;
            doClick(joinBtn);
            await sleep(2500);

            if (!onColorScreenStrict()) {
                savedColorIdx = idx;
                sessionStorage.setItem(ALT_ID + '_color', String(idx));
                swatchAttempt = 0;
                log('Joined');
                return true;
            }
            log('Color taken, cycling');
            swatchAttempt++;
            return false;
        }

        // bankruptcy
        function bankruptModalOpen() { return document.body.innerText.includes('File your bankruptcy'); }
        function findModalConfirm() {
            const all = [...document.querySelectorAll('button')];
            const bBtns = all.filter(b => norm(b.textContent) === 'bankrupt' && b.getBoundingClientRect().width > 0);
            for (const btn of bBtns) {
                let c = btn.parentElement;
                for (let d = 0; d < 6 && c; d++) {
                    if ([...c.querySelectorAll('button')].some(s => norm(s.textContent) === 'cancel')) return btn;
                    c = c.parentElement;
                }
            }
            return bBtns.length > 1 ? bBtns[bBtns.length - 1] : null;
        }
        async function handleBankrupt() {
            bankruptTries++;
            if (!bankruptModalOpen()) { if (!clickBtn('bankrupt', 'Open bankrupt')) return false; await sleep(1200); }
            if (!bankruptModalOpen()) return false;
            const confirm = findModalConfirm();
            if (!confirm) return false;
            doClick(confirm); await sleep(1000);
            if (!bankruptModalOpen()) { log('Bankrupted'); return true; }
            doClick(confirm); await sleep(1000);
            return !bankruptModalOpen();
        }

        // main loop
        captureIdentity();
        sessionStorage.setItem('room_url', location.href);
        log('Running | turns: ' + turnCount);

        while (botRunning) {
            try {
                // disconnect detection
                if (isDisconnected()) {
                    if (!wasDisconnected) {
                        document.title = '[!] DISCONNECTED';
                        updateStatus('Disconnected — verify in new tab', 'disconnected');
                        log('Connection lost — paused');
                        wasDisconnected = true;
                    }
                    await sleep(3000);
                    if (!isDisconnected()) {
                        document.title = 'Richup.io';
                        updateStatus('Running as ALT (' + ALT_ID + ')', 'running');
                        log('Reconnected');
                        wasDisconnected = false;
                    }
                    continue;
                }
                if (wasDisconnected) {
                    document.title = 'Richup.io';
                    updateStatus('Running as ALT (' + ALT_ID + ')', 'running');
                    wasDisconnected = false;
                }

                if (clickBtn('another game', 'Another game')) {
                    turnCount = 0; bankruptTries = 0; swatchAttempt = 0;
                    sessionStorage.setItem(ALT_ID + '_turns', '0');
                    restoreIdentity();
                    await sleep(1500); continue;
                }

                if (turnCount >= BANKRUPT_AFTER) {
                    if (await handleBankrupt()) {
                        turnCount = 0; bankruptTries = 0;
                        sessionStorage.setItem(ALT_ID + '_turns', '0');
                        await sleep(1500); continue;
                    }
                    if (bankruptModalOpen()) { await sleep(CHECK_MS); continue; }
                }

                if (onColorScreenStrict()) {
                    await pickAndJoin();
                    await sleep(CHECK_MS); continue;
                }

                const startBtn = getBtn(t => t === 'start game' || t === 'start');
                if (startBtn) {
                    if (!lobbyTime) { lobbyTime = Date.now(); log('Lobby'); }
                    if (Date.now() - lobbyTime >= 6000) {
                        doClick(startBtn); log('Started game');
                        lobbyTime = null; turnCount = 0;
                        await sleep(1500);
                    }
                    await sleep(CHECK_MS); continue;
                } else { lobbyTime = null; }

                let acted = false;
                if (!acted && clickBtn(t => t === 'roll the dice' || t === 'roll again', 'Roll')) {
                    turnCount++;
                    sessionStorage.setItem(ALT_ID + '_turns', String(turnCount));
                    log('Turn ' + turnCount + '/' + BANKRUPT_AFTER);
                    acted = true; await sleep(800);
                }
                if (!acted && clickBtn(t => t === 'buy' || t.startsWith('buy '), 'Buy')) { acted = true; await sleep(500); }
                if (!acted && clickBtn('end turn', 'End turn')) { acted = true; await sleep(500); }
                if (!acted && clickBtn(t => t === 'pay' || t.startsWith('pay '), 'Pay')) { acted = true; await sleep(500); }
                if (!acted && clickBtn(t => t === 'ok' || t === 'okay' || t === 'got it', 'OK')) { acted = true; await sleep(500); }

                if (!acted) { idleCount++; }
                await sleep(CHECK_MS);
            } catch (e) {
                console.error(`[${ALT_ID}]`, e);
                await sleep(CHECK_MS);
            }
        }
    }

    // ═══════════════════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════════════════

    // wait for page to settle before injecting GUI
    setTimeout(createGUI, 1500);

})();
