// ═══════════════════════════════════════════════════════
// RICHUP MAIN BOT (Console Version)
// ═══════════════════════════════════════════════════════

(function () {
    'use strict';

    const CHECK_MS = 700;

    function log(msg, type = 'info') {
        const prefix = `[RichUp Main] ${new Date().toLocaleTimeString()} `;
        const style = type === 'error' ? 'color: #ff6b6b' : (type === 'debug' ? 'color: #888' : 'color: #86efac');
        console.log(`%c${prefix}${msg}`, style);
    }

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

    function norm(s) { return s.trim().replace(/\s+/g, ' ').toLowerCase(); }

    function doClick(el) {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        // log(`Clicking: "${el.textContent.trim().substring(0, 20)}..."`, 'debug');

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

        const safeEl = el;
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
        for (const btn of document.querySelectorAll('button')) {
            if (btn.disabled) continue;
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

    // STATE
    let turnCount = Number(localStorage.getItem('main_turns')) || 0;
    let games = Number(localStorage.getItem('main_games')) || 0;
    let lobbyTime = null, waiting = false, swatchAttempt = 0;

    const clickBtn = (match, label) => {
        const btn = getBtn(match);
        if (btn) { doClick(btn); log(label); return true; }
        return false;
    };

    log('Started Main Bot (Console Version)');

    async function tick() {
        try {
            if (isModalOpen()) {
                log('Modal detected (How to play?), waiting...');
                await sleep(2000);
                setTimeout(tick, 100); return;
            }

            if (clickBtn('another game', 'Another game')) {
                games++; localStorage.setItem('main_games', String(games));
                turnCount = 0; localStorage.setItem('main_turns', '0');
                waiting = false; lobbyTime = null; swatchAttempt = 0;
                log('Game ' + games + ' done');
                setTimeout(tick, 2000); return;
            }

            const startBtn = getBtn(t => t.includes('start game') || t === 'start');
            if (startBtn) {
                if (!waiting) { waiting = true; lobbyTime = Date.now(); log('Waiting for players...'); }
                if (Date.now() - lobbyTime >= 4000) {
                    doClick(startBtn); log('Starting game');
                    waiting = false; lobbyTime = null;
                    turnCount = 0;
                    setTimeout(tick, 2000); return;
                }
                setTimeout(tick, CHECK_MS); return;
            } else {
                waiting = false;
            }

            if (onColorScreen()) {
                const swatches = findSwatches();
                if (swatches.length >= 4) {
                    const idx = swatchAttempt % swatches.length;
                    doClick(swatches[idx]);
                    await sleep(800);
                    if (clickBtn(t => t.includes('join game'), 'Join Game')) {
                        setTimeout(tick, 2000);
                        swatchAttempt++;
                        return;
                    }
                }
                setTimeout(tick, CHECK_MS); return;
            }

            if (isInLobby()) {
                setTimeout(tick, CHECK_MS); return;
            }

            let acted = false;
            if (!acted && clickBtn(t => t === 'roll the dice' || t === 'roll again', 'Roll')) {
                turnCount++; localStorage.setItem('main_turns', String(turnCount));
                log('Turn ' + turnCount); acted = true;
            }
            if (!acted && clickBtn(t => t === 'buy' || t.startsWith('buy '), 'Buy')) { acted = true; await sleep(500); }
            if (!acted && clickBtn('end turn', 'End turn')) { acted = true; await sleep(500); }
            if (!acted && clickBtn(t => t === 'pay' || t.startsWith('pay '), 'Pay')) { acted = true; await sleep(500); }
            if (!acted && clickBtn(t => t === 'ok' || t === 'okay' || t === 'got it', 'OK')) { acted = true; await sleep(500); }

            if (acted) setTimeout(tick, 800);
            else setTimeout(tick, CHECK_MS);

        } catch (e) {
            log(`Error: ${e.message}`, 'error');
            setTimeout(tick, CHECK_MS);
        }
    }

    tick();

})();
