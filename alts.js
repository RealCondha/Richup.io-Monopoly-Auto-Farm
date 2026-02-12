// RichUp Bot - Alt Accounts (Sacrificial)
// Use this on alternate accounts that should leave the game after 70 turns
// This allows the main account to win and collect coins

(function() {
    'use strict';
    
    const CONFIG = {
        DEBUG: true,
        BASE_DELAY: 500,
        MAX_DELAY: 2000,
        DELAY_MULTIPLIER: 1.5,
        RETRY_FAST_DELAY: 300,
        BANKRUPT_THRESHOLD: 70,
        GAME_START_BUTTONS: ["Another game", "Start", "Start Game", "Enter Game", "Join game"],
        ROLL_BUTTONS: ["Roll the dice", "Roll again"],
        END_TURN_BUTTONS: ["End turn", "Finish turn"],
        BUY_XPATH: '/html/body/div[1]/div[5]/div/div[2]/div/div/div[1]/div/div[2]/div[2]/div[1]/div/button/div',
        BANKRUPT_XPATHS: [
            '/html/body/div[1]/div[4]/div/div[3]/div/div[2]/div/button/div',
            '/html/body/div[6]/div/div/div/button[1]/div'
        ],
        TURN_COUNT_KEY: 'richup_alt_turn_count'
    };

    let currentDelay = CONFIG.BASE_DELAY;
    let lastActionTime = Date.now();
    let consecutiveNoActions = 0;
    let botStartTime = Date.now();
    let totalCycles = 0;
    let state = {
        lastAction: null,
        turnCount: Number(localStorage.getItem(CONFIG.TURN_COUNT_KEY)) || 0,
        bankruptMode: false
    };
    
    // Stats tracking
    let gamesCompleted = Number(localStorage.getItem('richup_alt_games_completed')) || 0;

    function log(...args) {
        if (CONFIG.DEBUG) {
            console.log(`[RichUp Alt Bot]`, ...args);
        }
    }

    function getBuyButton() {
        // First try: Look for buttons with buy-related text
        const buttons = getAllButtons();
        for (const button of buttons) {
            const text = button.textContent?.trim()?.toLowerCase() || '';
            if (text.includes('buy') || text.includes('purchase') || text.includes('acquire')) {
                log('Found buy button by text:', button.textContent.trim());
                return button;
            }
        }
        
        // Second try: XPath fallback
        try {
            const xpathBtn = document.evaluate(
                CONFIG.BUY_XPATH, 
                document, 
                null, 
                XPathResult.FIRST_ORDERED_NODE_TYPE, 
                null
            ).singleNodeValue;
            if (xpathBtn) {
                log('Found buy button by XPath');
                return xpathBtn;
            }
        } catch (e) {
            // XPath failed, continue
        }
        
        // Third try: Check for button in specific containers
        const possibleContainers = [
            document.querySelector('[class*="buy"] button'),
            document.querySelector('[class*="property"] button'),
            document.querySelector('[class*="purchase"] button'),
            document.querySelector('button[class*="buy"]'),
            document.querySelector('button[class*="purchase"]')
        ];
        
        for (const btn of possibleContainers) {
            if (btn && btn.offsetParent !== null) { // Check if visible
                log('Found buy button by class selector');
                return btn;
            }
        }
        
        return null;
    }

    function getBankruptButton() {
        for (const xpath of CONFIG.BANKRUPT_XPATHS) {
            try {
                const btn = document.evaluate(
                    xpath, 
                    document, 
                    null, 
                    XPathResult.FIRST_ORDERED_NODE_TYPE, 
                    null
                ).singleNodeValue;
                if (btn) return btn;
            } catch (e) {
                // XPath not found, try next
            }
        }
        return null;
    }

    function safeClick(element, description) {
        if (!element) return false;
        try {
            element.click();
            log(`Clicked: ${description}`);
            return true;
        } catch (e) {
            log(`Failed to click ${description}:`, e.message);
            return false;
        }
    }

    function getAllButtons() {
        try {
            return Array.from(document.getElementsByTagName('button'));
        } catch (e) {
            log('Error getting buttons:', e.message);
            return [];
        }
    }

    function shouldResetTurnCount(buttonText) {
        return CONFIG.GAME_START_BUTTONS.some(btn => buttonText.includes(btn));
    }

    function isRollButton(text) {
        return CONFIG.ROLL_BUTTONS.some(btn => text.toLowerCase().includes(btn.toLowerCase()));
    }

    function isEndTurnButton(text) {
        return CONFIG.END_TURN_BUTTONS.some(btn => text.toLowerCase().includes(btn.toLowerCase()));
    }

    function isBankruptButton(text) {
        return text.toLowerCase().includes('bankrupt');
    }

    function handleBankruptcy() {
        if (!state.bankruptMode) return false;
        
        log('🔍 Searching for bankruptcy modal/button...');
        
        // Method 1: Look for modal/dialog first
        const modal = document.querySelector('[role="dialog"]') || 
                      document.querySelector('.modal') || 
                      document.querySelector('[class*="modal"]') ||
                      document.querySelector('[class*="dialog"]');
        
        if (modal) {
            log('📋 Found modal/dialog');
            // Search within modal for bankrupt button
            const modalButtons = modal.querySelectorAll('button, [role="button"], div[class*="button"]');
            for (const btn of modalButtons) {
                const text = btn.textContent?.trim()?.toLowerCase() || '';
                if (text === 'bankrupt' || text.includes('bankrupt')) {
                    log('✅ Found bankrupt button in modal:', text);
                    // Try clicking the button or its parent
                    if (safeClick(btn, 'Bankrupt (Modal)')) {
                        // Also try clicking after a short delay for confirmation dialogs
                        setTimeout(() => {
                            safeClick(btn, 'Bankrupt (Modal Confirm)');
                        }, 300);
                        return true;
                    }
                }
            }
        }
        
        // Method 2: Try XPath selectors
        const bankruptBtnByXPath = getBankruptButton();
        if (bankruptBtnByXPath) {
            log('✅ Found bankrupt button by XPath');
            safeClick(bankruptBtnByXPath, 'Bankrupt (XPath)');
            // Try again after delay
            setTimeout(() => {
                safeClick(bankruptBtnByXPath, 'Bankrupt (XPath Retry)');
            }, 300);
            return true;
        }

        // Method 3: Search all buttons by text
        const buttons = getAllButtons();
        for (const button of buttons) {
            const text = button.textContent?.trim()?.toLowerCase() || '';
            if (text === 'bankrupt' || text.includes('bankrupt')) {
                log('✅ Found bankrupt button by text:', text);
                // Click the button
                safeClick(button, `Bankrupt (Text: ${text})`);
                // Try clicking parent if button itself doesn't work
                if (button.parentElement) {
                    setTimeout(() => {
                        safeClick(button.parentElement, 'Bankrupt (Parent)');
                    }, 300);
                }
                return true;
            }
        }
        
        // Method 4: Look for any orange/red colored buttons (bankrupt buttons are usually warning colors)
        const allClickables = document.querySelectorAll('button, [role="button"], div[onclick], a[onclick]');
        for (const el of allClickables) {
            const style = window.getComputedStyle(el);
            const bgColor = style.backgroundColor;
            const text = el.textContent?.trim()?.toLowerCase() || '';
            // Check if it's orange/red and has bankruptcy-related text
            if ((bgColor.includes('255') && bgColor.includes('99')) || // Orange-ish
                (bgColor.includes('220') && bgColor.includes('53')) ||  // Red-ish
                text === 'bankrupt') {
                log('🎯 Found potential bankrupt button by style:', text, bgColor);
                safeClick(el, 'Bankrupt (Style match)');
                return true;
            }
        }
        
        log('❌ No bankrupt button found this cycle');
        return false;
    }

    function processButtons() {
        const buttons = getAllButtons();
        let actionTaken = false;
        let actionsThisCycle = [];

        // Check bankruptcy FIRST if threshold reached
        if (state.turnCount >= CONFIG.BANKRUPT_THRESHOLD || state.bankruptMode) {
            if (!state.bankruptMode) {
                state.bankruptMode = true;
                log(`🚨 BANKRUPT MODE ACTIVATED! Turn ${state.turnCount}/${CONFIG.BANKRUPT_THRESHOLD}`);
                log('Looking for bankrupt button...');
            }
            
            // Keep trying to click bankrupt every cycle until successful
            if (handleBankruptcy()) {
                actionTaken = true;
                actionsThisCycle.push('bankrupt');
                // Don't return early - keep trying to click in case it needs multiple clicks
            } else {
                // Still in bankrupt mode but couldn't click yet
                log('⏳ Waiting for bankruptcy modal to appear...');
            }
        }

        // Priority 2: Check for buy button (must buy properties!)
        const buyButton = getBuyButton();
        if (buyButton) {
            if (safeClick(buyButton, 'Buy Property')) {
                actionTaken = true;
                actionsThisCycle.push('buy');
                // Return early - don't roll until buy is handled
                return { actionTaken, actionsThisCycle };
            }
        }

        // Priority 3: Process all other buttons
        for (const button of buttons) {
            const buttonText = button.textContent?.trim() || '';
            if (!buttonText) continue;

            // Check for game start buttons (reset turn count)
            if (shouldResetTurnCount(buttonText)) {
                state.turnCount = 0;
                state.bankruptMode = false;
                localStorage.setItem(CONFIG.TURN_COUNT_KEY, '0');
                if (safeClick(button, `Game Control: ${buttonText}`)) {
                    actionTaken = true;
                    actionsThisCycle.push('game-start');
                    // Track game completion when starting a new game
                    if (buttonText.toLowerCase().includes('another')) {
                        gamesCompleted++;
                        localStorage.setItem('richup_alt_games_completed', String(gamesCompleted));
                        log(`🎮 Game ${gamesCompleted} completed! Rejoining for next game...`);
                        log('✅ Exited via bankruptcy - can now rejoin and help main win again');
                    }
                }
                continue;
            }

            // Skip bankrupt button if not in bankrupt mode
            if (isBankruptButton(buttonText) && !state.bankruptMode) {
                continue;
            }

            // Check for roll dice
            if (isRollButton(buttonText)) {
                if (safeClick(button, `Roll: ${buttonText}`)) {
                    actionTaken = true;
                    state.turnCount++;
                    localStorage.setItem(CONFIG.TURN_COUNT_KEY, String(state.turnCount));
                    log(`Turn count: ${state.turnCount}/${CONFIG.BANKRUPT_THRESHOLD}`);
                    
                    if (state.turnCount >= CONFIG.BANKRUPT_THRESHOLD) {
                        log(`⚠️ Approaching bankruptcy! ${state.turnCount} turns`);
                    }
                    
                    actionsThisCycle.push('roll');
                }
                continue;
            }

            // Check for end turn
            if (isEndTurnButton(buttonText)) {
                if (safeClick(button, `End Turn: ${buttonText}`)) {
                    actionTaken = true;
                    actionsThisCycle.push('end-turn');
                }
                continue;
            }
        }

        return { actionTaken, actionsThisCycle };
    }

    function calculateNextDelay(actionTaken) {
        // Fast retry when in bankrupt mode (need to click that modal quickly)
        if (state.bankruptMode) {
            return CONFIG.RETRY_FAST_DELAY; // 300ms - fast retry to catch modal
        }
        
        if (actionTaken) {
            // Action taken - reset to base delay
            consecutiveNoActions = 0;
            return CONFIG.BASE_DELAY;
        } else {
            // No action - increase delay up to max
            consecutiveNoActions++;
            const newDelay = Math.min(
                CONFIG.BASE_DELAY * Math.pow(CONFIG.DELAY_MULTIPLIER, consecutiveNoActions),
                CONFIG.MAX_DELAY
            );
            
            // If stuck for too long, retry faster
            if (consecutiveNoActions > 5) {
                log('No actions for 5+ cycles, retrying faster');
                return CONFIG.RETRY_FAST_DELAY;
            }
            
            return Math.round(newDelay);
        }
    }

    function runBot() {
        // Infinite farming - no max runtime
        totalCycles++;
        
        // Log every 1000 cycles to show it's alive
        if (totalCycles % 1000 === 0) {
            const runtime = Math.round((Date.now() - botStartTime) / 1000 / 60);
            log(`🔄 Running for ${runtime} mins | ${totalCycles} cycles | ${gamesCompleted} games completed | Turns: ${state.turnCount}`);
        }
        
        try {
            const { actionTaken, actionsThisCycle } = processButtons();
            
            if (actionTaken) {
                lastActionTime = Date.now();
                if (CONFIG.DEBUG) {
                    log(`Actions this cycle: ${actionsThisCycle.join(', ') || 'none'}`);
                }
            }

            currentDelay = calculateNextDelay(actionTaken);
            
            if (!actionTaken && CONFIG.DEBUG) {
                log(`No action, waiting ${currentDelay}ms (attempt ${consecutiveNoActions})`);
            }

        } catch (error) {
            log('Error in bot loop:', error.message);
            currentDelay = CONFIG.RETRY_FAST_DELAY;
        }

        // Schedule next run
        setTimeout(runBot, currentDelay);
    }

    // Start the bot
    log('RichUp Alt Bot started!');
    log('Turn count:', state.turnCount);
    log(`Will bankrupt after ${CONFIG.BANKRUPT_THRESHOLD} turns`);
    runBot();

})();