// RichUp Bot - Main Account (Winner)
// Use this on your main account that should win the game
// This bot plays normally and NEVER bankrupts

(function() {
    'use strict';
    
    const CONFIG = {
        DEBUG: true,
        BASE_DELAY: 500,
        MAX_DELAY: 2000,
        DELAY_MULTIPLIER: 1.5,
        RETRY_FAST_DELAY: 300,
        GAME_START_BUTTONS: ["Another game", "Start", "Start Game", "Enter Game", "Join game"],
        ROLL_BUTTONS: ["Roll the dice", "Roll again"],
        END_TURN_BUTTONS: ["End turn", "Finish turn"],
        BUY_XPATH: '/html/body/div[1]/div[5]/div/div[2]/div/div/div[1]/div/div[2]/div[2]/div[1]/div/button/div',
        TURN_COUNT_KEY: 'richup_main_turn_count'
    };

    let currentDelay = CONFIG.BASE_DELAY;
    let lastActionTime = Date.now();
    let consecutiveNoActions = 0;
    let botStartTime = Date.now();
    let totalCycles = 0;
    let state = {
        lastAction: null,
        turnCount: Number(localStorage.getItem(CONFIG.TURN_COUNT_KEY)) || 0
    };
    
    // Stats tracking
    let gamesCompleted = Number(localStorage.getItem('richup_games_completed')) || 0;

    function log(...args) {
        if (CONFIG.DEBUG) {
            console.log(`[RichUp Main Bot]`, ...args);
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

    function processButtons() {
        const buttons = getAllButtons();
        let actionTaken = false;
        let actionsThisCycle = [];

        // Priority 1: Check for buy button (must buy properties!)
        const buyButton = getBuyButton();
        if (buyButton) {
            if (safeClick(buyButton, 'Buy Property')) {
                actionTaken = true;
                actionsThisCycle.push('buy');
                // Return early - don't roll until buy is handled
                return { actionTaken, actionsThisCycle };
            }
        }

        // Priority 2: Process all other buttons
        for (const button of buttons) {
            const buttonText = button.textContent?.trim() || '';
            if (!buttonText) continue;

            // Check for game start buttons (reset turn count)
            if (shouldResetTurnCount(buttonText)) {
                state.turnCount = 0;
                localStorage.setItem(CONFIG.TURN_COUNT_KEY, '0');
                if (safeClick(button, `Game Control: ${buttonText}`)) {
                    actionTaken = true;
                    actionsThisCycle.push('game-start');
                    // Track game completion when starting a new game
                    if (buttonText.toLowerCase().includes('another')) {
                        gamesCompleted++;
                        localStorage.setItem('richup_games_completed', String(gamesCompleted));
                        log(`🎮 Game ${gamesCompleted} completed! Starting new game...`);
                    }
                }
                continue;
            }

            // Check for roll dice
            if (isRollButton(buttonText)) {
                if (safeClick(button, `Roll: ${buttonText}`)) {
                    actionTaken = true;
                    state.turnCount++;
                    localStorage.setItem(CONFIG.TURN_COUNT_KEY, String(state.turnCount));
                    log(`Turn count: ${state.turnCount}`);
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
            log(`🔄 Running for ${runtime} mins | ${totalCycles} cycles | ${gamesCompleted} games completed`);
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
    log('RichUp Main Bot started!');
    log('Turn count:', state.turnCount);
    log('This bot will play to WIN (no bankruptcy)');
    runBot();

})();