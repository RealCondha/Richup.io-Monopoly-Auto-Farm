// RichUp Bot - Alt Account
(function () {
    'use strict';

    const MY_COLOR = -1;         // swatch index override (-1 = auto)
    const BANKRUPT_AFTER = 70;   // turns before auto-bankruptcy
    const CHECK_MS = 700;        // poll interval

    const ALT_ID = sessionStorage.getItem('alt_id') || (() => {
        const id = 'alt_' + Math.random().toString(36).slice(2, 6);
        sessionStorage.setItem('alt_id', id);
        return id;
    })();

    let turnCount = Number(sessionStorage.getItem(ALT_ID + '_turns')) || 0;
    let savedColorIdx = sessionStorage.getItem(ALT_ID + '_color') !== null
        ? Number(sessionStorage.getItem(ALT_ID + '_color')) : null;
    let bankruptTries = 0;
    let swatchAttempt = 0;
    let lobbyTime = null;
    let idleCount = 0;
    let wasDisconnected = false;

    // hash alt id for deterministic color offset
    let h = 0;
    for (let i = 0; i < ALT_ID.length; i++) h = ((h << 5) - h) + ALT_ID.charCodeAt(i);
    const autoOffset = Math.abs(h);

    const log = msg => console.log(`[${ALT_ID}] ${msg}`);
    const sleep = ms => new Promise(r => setTimeout(r, ms + Math.random() * 200));

    // --- identity persistence (name/settings across games) ---

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
        const heading = findHeadingContainer();
        if (heading) {
            const sw = filterSwatchButtons(heading.querySelectorAll('button:not([disabled])'));
            if (sw.length >= 4) return sw;
        }
        // fallback: scan all buttons with inline color + svg
        return filterSwatchButtons(document.querySelectorAll('button:not([disabled])'), true);
    }

    function filterSwatchButtons(buttons, requireColor) {
        return [...buttons].filter(btn => {
            const rect = btn.getBoundingClientRect();
            if (rect.width < 15 || rect.width > 90) return false;
            if (rect.height < 15 || rect.height > 90) return false;
            if (!btn.querySelector('svg')) return false;
            if (btn.textContent.trim().length > 5) return false;
            if (requireColor) {
                const color = btn.style.color;
                if (!color || !color.startsWith('rgb')) return false;
            }
            return true;
        });
    }

    function findHeadingContainer() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let textNode;
        while (textNode = walker.nextNode()) {
            if (textNode.textContent.toLowerCase().includes('select your')) {
                let container = textNode.parentElement;
                for (let lvl = 0; lvl < 6 && container; lvl++) {
                    if (container.querySelectorAll('button').length >= 4) return container;
                    container = container.parentElement;
                }
                break;
            }
        }
        return null;
    }

    // checks for visible join button + appearance text
    function onColorScreen() {
        const joinBtn = getBtn('join game') || getBtn(t => t.includes('join game'));
        if (!joinBtn) return false;
        const body = document.body.innerText.toLowerCase();
        return body.includes('select your') && body.includes('appearance');
    }

    // --- color selection + join ---

    async function pickAndJoin() {
        const swatches = findSwatches();
        if (swatches.length < 4) {
            log('Only ' + swatches.length + ' swatches found');
            return false;
        }

        let idx;
        if (MY_COLOR >= 0) {
            idx = MY_COLOR % swatches.length;
        } else if (savedColorIdx !== null && swatchAttempt === 0) {
            idx = savedColorIdx % swatches.length;
        } else {
            idx = (autoOffset + swatchAttempt) % swatches.length;
        }

        log('Swatch ' + idx + '/' + swatches.length + ' (attempt ' + swatchAttempt + ')');
        doClick(swatches[idx]);
        await sleep(1200);

        const joinBtn = getBtn('join game') || getBtn(t => t.includes('join game'));
        if (!joinBtn) return false;

        doClick(joinBtn);
        await sleep(2500);

        if (!onColorScreen()) {
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

    // --- bankruptcy ---

    function bankruptModalOpen() {
        return document.body.innerText.includes('File your bankruptcy');
    }

    function findModalConfirm() {
        const all = [...document.querySelectorAll('button')];
        const bBtns = all.filter(b =>
            norm(b.textContent) === 'bankrupt' && b.getBoundingClientRect().width > 0);
        // find the confirm button (sibling of cancel)
        for (const btn of bBtns) {
            let c = btn.parentElement;
            for (let d = 0; d < 6 && c; d++) {
                if ([...c.querySelectorAll('button')].some(
                    s => norm(s.textContent) === 'cancel')) return btn;
                c = c.parentElement;
            }
        }
        return bBtns.length > 1 ? bBtns[bBtns.length - 1] : null;
    }

    async function handleBankrupt() {
        bankruptTries++;
        if (!bankruptModalOpen()) {
            if (!clickBtn('bankrupt', 'Open bankrupt')) return false;
            await sleep(1200);
        }
        if (!bankruptModalOpen()) return false;
        const confirm = findModalConfirm();
        if (!confirm) return false;
        doClick(confirm);
        await sleep(1000);
        if (!bankruptModalOpen()) { log('Bankrupted'); return true; }
        doClick(confirm);
        await sleep(1000);
        return !bankruptModalOpen();
    }

    // --- main loop ---

    async function bot() {
        captureIdentity();
        sessionStorage.setItem('room_url', location.href);
        log('Running | turns: ' + turnCount);

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

                if (onColorScreen()) {
                    await pickAndJoin();
                    await sleep(CHECK_MS); continue;
                }

                // start game if this tab is host
                const startBtn = getBtn(t => t === 'start game' || t === 'start');
                if (startBtn) {
                    if (!lobbyTime) { lobbyTime = Date.now(); log('Lobby, waiting 6s'); }
                    if (Date.now() - lobbyTime >= 6000) {
                        doClick(startBtn); log('Started game');
                        lobbyTime = null; turnCount = 0;
                        await sleep(1500);
                    }
                    await sleep(CHECK_MS); continue;
                } else { lobbyTime = null; }

                // gameplay actions
                let acted = false;
                if (!acted && clickBtn(t => t === 'roll the dice' || t === 'roll again', 'Roll')) {
                    turnCount++;
                    sessionStorage.setItem(ALT_ID + '_turns', String(turnCount));
                    log('Turn ' + turnCount + '/' + BANKRUPT_AFTER);
                    acted = true; await sleep(800);
                }
                if (!acted && clickBtn(t => t === 'buy' || t.startsWith('buy '), 'Buy')) {
                    acted = true; await sleep(500);
                }
                if (!acted && clickBtn('end turn', 'End turn')) {
                    acted = true; await sleep(500);
                }
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
            } catch (e) {
                console.error(`[${ALT_ID}]`, e);
                await sleep(CHECK_MS);
            }
        }
    }

    bot();
})();
