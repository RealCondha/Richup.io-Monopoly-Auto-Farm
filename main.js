// ═══════════════════════════════════════════════════════
// RICHUP MAIN BOT (Console Version)
// ═══════════════════════════════════════════════════════

(function () {
    'use strict';

    const CHECK_MS = 700;

    let logCount = 0;
    function log(msg, type = 'info') {
        if (++logCount % 80 === 0) console.clear(); // Prevent memory bloat
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
                        log('Joining game, waiting for lobby...');
                        for (let w = 0; w < 15; w++) {
                            await sleep(500);
                            if (!onColorScreen()) break;
                        }
                        swatchAttempt++;
                        return;
                    }
                }
                setTimeout(tick, CHECK_MS); return;
            }

            if (isInLobby()) {
                setTimeout(tick, CHECK_MS); return;
            }

            // AFK VOTEKICK FAILSAFE
            const lastAction = Number(localStorage.getItem('rb_last_action')) || Date.now();
            if (Date.now() - lastAction > 35000) {
                log('AFK Failsafe triggered: No actions in 35s. Kicking inactive players...');
                const voteKickBtn = getBtn(t => t.includes('votekick'));
                if (voteKickBtn) {
                    doClick(voteKickBtn);
                    await sleep(1000); // wait for modal
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
                localStorage.setItem('rb_last_action', Date.now()); // Reset timer
            }

            let acted = false;
            const recordAction = () => localStorage.setItem('rb_last_action', Date.now());

            if (!acted && clickBtn(t => t === 'roll the dice' || t === 'roll again', 'Roll')) {
                turnCount++; localStorage.setItem('main_turns', String(turnCount));
                recordAction();
                log('Turn ' + turnCount); acted = true;
            }
            if (!acted && clickBtn(t => t === 'buy' || t.startsWith('buy '), 'Buy')) { recordAction(); acted = true; await sleep(500); }
            if (!acted && clickBtn('end turn', 'End turn')) { recordAction(); acted = true; await sleep(500); }
            if (!acted && clickBtn(t => t === 'pay' || t.startsWith('pay '), 'Pay')) { recordAction(); acted = true; await sleep(500); }
            if (!acted && clickBtn(t => t === 'ok' || t === 'okay' || t === 'got it', 'OK')) { recordAction(); acted = true; await sleep(500); }

            if (acted) setTimeout(tick, 800);
            else setTimeout(tick, CHECK_MS);

        } catch (e) {
            log(`Error: ${e.message}`, 'error');
            setTimeout(tick, CHECK_MS);
        }
    }

    tick();

})();
