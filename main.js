// RichUp Bot - Main Account
(function () {
    'use strict';

    const CHECK_MS = 700;        // poll interval
    const LOBBY_WAIT = 6000;     // wait in lobby before starting

    let turnCount = Number(localStorage.getItem('main_turns')) || 0;
    let games = Number(localStorage.getItem('main_games')) || 0;
    let lobbyTime = null;
    let waiting = false;
    let idleCount = 0;
    let swatchAttempt = 0;
    let wasDisconnected = false;

    const log = msg => console.log('[MAIN] ' + msg);
    const sleep = ms => new Promise(r => setTimeout(r, ms + Math.random() * 200));

    // --- click dispatch (full pointer/mouse chain + react fiber walk) ---

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

        // walk dom + react fiber for handler invocation
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
                if (found) return true;
            }
            if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) {
                let f = el[k], d = 0;
                while (f && d < 15) {
                    const mp = f.memoizedProps;
                    if (mp) {
                        if (typeof mp.onClick === 'function') { try { mp.onClick(fe); } catch (e) { } return true; }
                        if (typeof mp.onMouseDown === 'function') { try { mp.onMouseDown({ ...fe, type: 'mousedown' }); } catch (e) { } return true; }
                    }
                    f = f.return; d++;
                }
            }
        }
        return false;
    }

    // --- button helpers ---

    const BLACKLIST = [
        'share', 'copy', 'invite', 'sound', 'spectate', 'return to lobby',
        'go to lobby', 'get more', 'change appearance', 'login', 'sign up',
        'see all', 'private room', 'log in', 'settings', 'appearance'
    ];

    function norm(s) { return s.trim().replace(/\s+/g, ' ').toLowerCase(); }

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

    function clickBtn(match, label) {
        const btn = getBtn(match);
        if (btn) { doClick(btn); log(label); idleCount = 0; return true; }
        return false;
    }

    // --- disconnect detection + recovery ---

    // disconnect detection — disabled until we can identify exact overlay element
    function isDisconnected() {
        return false;
    }

    // --- swatch detection (appearance selection screen) ---
    // swatches are small <button> elements containing SVG icons

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
        // fallback: scan all buttons with inline color + svg
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

    // checks for visible join button
    function onColorScreen() {
        const joinBtn = getBtn('join game') || getBtn(t => t.includes('join game'));
        return !!joinBtn;
    }

    // --- main loop ---

    async function bot() {
        sessionStorage.setItem('room_url', location.href);
        log('Running | games: ' + games + ' | turns: ' + turnCount);
        while (true) {
            try {
                // disconnect detection — pause until resolved
                if (isDisconnected()) {
                    if (!wasDisconnected) {
                        document.title = '[!] DISCONNECTED';
                        log('Connection lost — paused. Verify in a new tab.');
                        wasDisconnected = true;
                    }
                    await sleep(3000);
                    if (!isDisconnected()) {
                        document.title = 'Richup.io';
                        log('Reconnected — resuming');
                        wasDisconnected = false;
                    }
                    continue;
                }
                if (wasDisconnected) {
                    document.title = 'Richup.io';
                    log('Reconnected — resuming');
                    wasDisconnected = false;
                }

                if (clickBtn('another game', 'Another game')) {
                    games++; localStorage.setItem('main_games', String(games));
                    turnCount = 0; localStorage.setItem('main_turns', '0');
                    waiting = false; lobbyTime = null; swatchAttempt = 0;
                    log('Game ' + games + ' done');
                    await sleep(800); continue;
                }

                // color selection + join
                if (onColorScreen()) {
                    const swatches = findSwatches();
                    if (swatches.length >= 4) {
                        const idx = swatchAttempt % swatches.length;
                        log('Swatch ' + idx + '/' + swatches.length + ' (attempt ' + swatchAttempt + ')');
                        doClick(swatches[idx]);
                        await sleep(800);

                        const joinBtn = getBtn('join game') || getBtn(t => t.includes('join game'));
                        if (joinBtn) {
                            doClick(joinBtn);
                            await sleep(2000);

                            if (!onColorScreen()) {
                                log('Joined');
                                swatchAttempt = 0;
                            } else {
                                log('Color taken, trying next');
                                swatchAttempt++;
                                await sleep(3000);
                            }
                        }
                    }
                    await sleep(CHECK_MS); continue;
                }

                // start game after lobby wait
                const startBtn = getBtn(t => t === 'start game' || t === 'start');
                if (startBtn) {
                    if (!waiting) {
                        waiting = true; lobbyTime = Date.now();
                        log('Lobby, waiting ' + (LOBBY_WAIT / 1000) + 's');
                    }
                    if (Date.now() - lobbyTime >= LOBBY_WAIT) {
                        doClick(startBtn); log('Started game');
                        waiting = false; lobbyTime = null; turnCount = 0;
                        await sleep(1500);
                    }
                    await sleep(CHECK_MS); continue;
                } else { waiting = false; }

                // gameplay actions
                let acted = false;
                if (!acted && clickBtn(t => t === 'roll the dice' || t === 'roll again', 'Roll')) {
                    turnCount++; localStorage.setItem('main_turns', String(turnCount));
                    log('Turn ' + turnCount); acted = true; await sleep(800);
                }
                if (!acted && clickBtn(t => t === 'buy' || t.startsWith('buy '), 'Buy')) {
                    acted = true; await sleep(500);
                }
                if (!acted && clickBtn('end turn', 'End turn')) { acted = true; await sleep(500); }
                if (!acted && clickBtn(t => t === 'pay' || t.startsWith('pay '), 'Pay')) {
                    acted = true; await sleep(500);
                }
                if (!acted && clickBtn(t => t === 'ok' || t === 'okay' || t === 'got it', 'OK')) {
                    acted = true; await sleep(500);
                }

                if (!acted) {
                    idleCount++;
                    if (idleCount % 250 === 0) {
                        log('Idle ' + Math.round(idleCount * CHECK_MS / 1000) + 's');
                        const btns = [...document.querySelectorAll('button')].filter(
                            b => b.getBoundingClientRect().width > 0 && !b.disabled);
                        log('Visible buttons: ' + btns.map(b => norm(b.textContent).slice(0, 25)).join(', '));
                    }
                }
                await sleep(CHECK_MS);
            } catch (e) { console.error('[MAIN]', e); await sleep(CHECK_MS); }
        }
    }

    bot();
})();
