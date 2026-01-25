let currentStake = 10;
let ws = null;
let selectedCardId = null;

document.addEventListener('DOMContentLoaded', () => {
    showLandingScreen();
    initializeGlobalMenu();
    initializeAuth();
    
    document.getElementById('do-login-btn')?.addEventListener('click', async () => {
        const telegramId = document.getElementById('login-telegram-id').value;
        const password = document.getElementById('login-password').value;

        if (!telegramId || !password) {
            return modernAlert('እባክዎ ሁሉንም መረጃዎች በትክክል ይሙሉ!');
        }

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telegramId, password })
            });
            const data = await res.json();
            if (data.success) {
                localStorage.setItem('bingo_token', data.token);
                localStorage.setItem('bingo_user', JSON.stringify(data.user));
                modernAlert('እንኳን በደህና መጡ!', 'ሰላም');
                showScreen('stake-screen');
            } else {
                modernAlert(data.error || 'ስህተት ተከስቷል');
            }
        } catch (e) {
            modernAlert('ከሰርቨር ጋር መገናኘት አልተቻለም');
        }
    });

    // Wallet actions
    document.getElementById('submit-deposit-btn')?.addEventListener('click', async () => {
        const smsText = document.getElementById('deposit-sms-text').value;
        const inputAmount = document.getElementById('deposit-amount').value;
        const method = document.getElementById('deposit-method').value;

        if (!inputAmount || isNaN(inputAmount) || inputAmount <= 0) {
            return modernAlert('እባክዎ ትክክለኛ የብር መጠን ያስገቡ!');
        }
        if (!smsText || smsText.length < 10) {
            return modernAlert('እባክዎ ከቴሌብር የደረስዎትን ሙሉ መልእክት እዚህ ይለጥፉ!');
        }

        // Extract Transaction ID from SMS
        let transactionId = "Not Extracted";
        const txMatch = smsText.match(/(?:Transaction ID|መለያ ቁጥር|ID)[:\s]+([A-Z0-9]+)/i) || smsText.match(/([A-Z0-9]{10,})/);
        if (txMatch) transactionId = txMatch[1];

        try {
            const token = localStorage.getItem('bingo_token');
            const res = await fetch('/api/deposit', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    amount: inputAmount, 
                    transactionId: transactionId, 
                    method: method,
                    smsText: smsText
                })
            });
            const data = await res.json();
            if (data.success) {
                await modernAlert('የዲፖዚት ጥያቄዎ ለአድሚን ተልኳል! በቅርቡ ተረጋግጦ ይገባሎታል።', 'ተልኳል');
                showScreen('wallet-screen');
                // Clear form
                document.getElementById('deposit-sms-text').value = '';
            } else {
                modernAlert(data.error || 'ስህተት ተከስቷል');
            }
        } catch (e) {
            modernAlert('ከሰርቨር ጋር መገናኘት አልተቻለም');
        }
    });

    document.getElementById('submit-withdraw-btn')?.addEventListener('click', async () => {
        const amount = document.getElementById('withdraw-amount').value;
        const method = document.getElementById('withdraw-method').value;
        const accountDetails = document.getElementById('withdraw-details').value;

        if (!amount || isNaN(amount) || amount <= 0) {
            return modernAlert('እባክዎ ትክክለኛ የብር መጠን ያስገቡ!');
        }
        if (!accountDetails) {
            return modernAlert('እባክዎ የአካውንት ዝርዝርዎን ያስገቡ!');
        }

        try {
            const token = localStorage.getItem('bingo_token');
            const res = await fetch('/api/withdraw', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ amount, method, accountDetails })
            });
            const data = await res.json();
            if (data.success) {
                await modernAlert('የዊዝድሮው ጥያቄዎ ለአድሚን ተልኳል! በቅርቡ ይረጋገጣል።', 'ተልኳል');
                showScreen('wallet-screen');
                loadWallet();
                // Clear form
                document.getElementById('withdraw-amount').value = '';
                document.getElementById('withdraw-details').value = '';
            } else {
                modernAlert(data.error || 'ስህተት ተከስቷል');
            }
        } catch (e) {
            modernAlert('ከሰርቨር ጋር መገናኘት አልተቻለም');
        }
    });

    const getStartedBtn = document.getElementById('get-started-btn');
    if (getStartedBtn) {
        console.log('Attaching click to get-started-btn');
        const handleGetStarted = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            console.log('Get Started Clicked');
            const token = localStorage.getItem('bingo_token');
            if (token) {
                showScreen('stake-screen');
            } else {
                showScreen(document.getElementById('register-screen') ? 'register-screen' : 'register-screen');
            }
        };
        getStartedBtn.onclick = handleGetStarted;
        getStartedBtn.addEventListener('click', handleGetStarted, { capture: true });
    }
    
    // Global fallback for index.html
    window.handleGetStartedFallback = () => {
        console.log('Global Fallback Get Started');
        const token = localStorage.getItem('bingo_token');
        if (token) showScreen('stake-screen');
        else showScreen('register-screen');
    };

    const backToLandingBtn = document.getElementById('back-to-landing-btn');
    if (backToLandingBtn) {
        backToLandingBtn.onclick = () => {
            showLandingScreen();
        };
    }

    const goToRegisterBtn = document.getElementById('go-to-register-btn');
    if (goToRegisterBtn) {
        goToRegisterBtn.onclick = () => {
            showScreen('register-screen');
        };
    }

    document.getElementById('do-register-btn')?.addEventListener('click', async () => {
        const username = document.getElementById('reg-name').value;
        const telegramId = document.getElementById('reg-telegram-id').value;
        const password = document.getElementById('reg-password').value;

        if (!username || !telegramId || !password) {
            return modernAlert('እባክዎ ሁሉንም መረጃዎች በትክክል ይሙሉ!');
        }

        // Get referrer ID from URL if present
        const urlParams = new URLSearchParams(window.location.search);
        const referrerId = urlParams.get('ref');

        try {
            const res = await fetch('/api/request-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, telegramId, password, referrerId })
            });
            const data = await res.json();
            if (data.success) {
                showScreen('otp-screen');
            } else {
                modernAlert(data.error || 'ስህተት ተከስቷል');
            }
        } catch (e) {
            modernAlert('ከሰርቨር ጋር መገናኘት አልተቻለም');
        }
    });

    document.getElementById('verify-otp-btn')?.addEventListener('click', async () => {
        const otp = document.getElementById('otp-input').value;
        const telegramId = document.getElementById('reg-telegram-id').value;

        if (otp.length !== 6) return modernAlert('እባክዎ ባለ 6 ዲጂት ኮድ ያስገቡ');

        try {
            const res = await fetch('/api/verify-registration', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ telegramId, otp })
            });
            const data = await res.json();
            if (data.success) {
                localStorage.setItem('bingo_token', data.token);
                localStorage.setItem('bingo_user', JSON.stringify(data.user));
                modernAlert('ምዝገባዎ በሚገባ ተጠናቋል!', 'እንኳን ደስ አለዎት');
                showScreen('stake-screen');
            } else {
                modernAlert(data.error || 'የተሳሳተ ኮድ');
            }
        } catch (e) {
            modernAlert('ከሰርቨር ጋር መገናኘት አልተቻለም');
        }
    });

    document.getElementById('start-game-btn')?.addEventListener('click', () => {
        showSelectionScreen();
        initWebSocket();
    });

    // Global fallback for Start Game
    window.handleStartGameFallback = () => {
        console.log('Global Fallback Start Game');
        showSelectionScreen();
        initWebSocket();
    };

    window.handleRefreshCards = () => {
        console.log('Refreshing cards...');
        const btn = document.getElementById('refresh-cards-btn');
        if (btn) btn.classList.add('rotating');
        
        generateCardGrid();
        loadWallet();
        
        setTimeout(() => {
            if (btn) btn.classList.remove('rotating');
        }, 1000);
    };

    document.querySelectorAll('.stake-btn').forEach(btn => {
        btn.onclick = () => {
            if (btn.classList.contains('soon')) return;
            document.querySelectorAll('.stake-btn').forEach(b => b.classList.remove('active-stake'));
            btn.classList.add('active-stake');
            currentStake = parseInt(btn.dataset.stake);
            const stakeValueEl = document.getElementById('current-stake');
            if (stakeValueEl) stakeValueEl.textContent = currentStake;
        };
    });
});

function showLandingScreen() {
    showScreen('landing-screen');
}

function showSelectionScreen() {
    showScreen('selection-screen');
    generateCardGrid();
}

function updateTimerDisplay(timeLeft, status) {
    const timerDisplay = document.querySelector('.time-value');
    if (!timerDisplay) return;

    timerDisplay.textContent = timeLeft + 's';
    
    if (status === 'playing') {
        timerDisplay.style.background = '#888';
        timerDisplay.textContent = 'Playing';
    } else {
        timerDisplay.style.background = '#ff4757';
    }
}

function updateTakenCards(takenCards) {
    const cardItems = document.querySelectorAll('.card-item');
    cardItems.forEach(item => {
        const cardId = parseInt(item.textContent);
        if (takenCards.includes(cardId)) {
            item.classList.add('taken');
            if (selectedCardId !== cardId) {
                item.style.opacity = '1';
                item.style.pointerEvents = 'none';
                item.style.background = 'var(--color-red)';
                item.style.boxShadow = '0 0 15px var(--color-red)';
            }
        } else {
            item.classList.remove('taken');
            item.style.opacity = '1';
            item.style.pointerEvents = 'auto';
            item.style.background = '';
            item.style.boxShadow = '';
        }
    });
}

function updateGameStats(playerCount, prizePool) {
    const playerCountEl = document.getElementById('player-count');
    const prizePoolEl = document.getElementById('prize-pool');
    const gameStakeEl = document.getElementById('game-stake');
    
    if (playerCountEl) playerCountEl.textContent = playerCount;
    if (prizePoolEl) prizePoolEl.textContent = parseFloat(prizePool || 0).toFixed(2);
    if (gameStakeEl) gameStakeEl.textContent = parseFloat(currentStake || 10).toFixed(2);
}

function initMasterGrid() {
    const grid = document.getElementById('master-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = 1; i <= 75; i++) {
        const cell = document.createElement('div');
        cell.className = 'master-cell';
        cell.id = `master-num-${i}`;
        cell.textContent = i;
        grid.appendChild(cell);
    }
}

function renderPlayerCard(cardId) {
    const grid = document.getElementById('player-bingo-card');
    if (!grid || !BINGO_CARDS[cardId]) return;
    
    grid.innerHTML = '';
    const cardData = BINGO_CARDS[cardId];
    
    cardData.forEach((row) => {
        row.forEach((num) => {
            const cell = document.createElement('div');
            cell.className = 'bingo-cell';
            if (num === 0) {
                cell.textContent = 'FREE';
                cell.classList.add('marked', 'free-space');
            } else {
                cell.textContent = num;
            }
            grid.appendChild(cell);
        });
    });
}

function updateCalledNumbers(num, allCalled) {
    const lastNumEl = document.getElementById('last-number');
    const lastLetterEl = document.getElementById('last-letter');
    if (lastNumEl && lastLetterEl) {
        lastNumEl.textContent = num;
        lastLetterEl.textContent = getLetter(num);
        
        // Add highlighting effect for last number
        lastNumEl.classList.remove('last-number-pop');
        void lastNumEl.offsetWidth; // Trigger reflow
        lastNumEl.classList.add('last-number-pop');
    }

    const masterCell = document.getElementById(`master-num-${num}`);
    if (masterCell) masterCell.classList.add('called');

    const prev1 = document.getElementById('prev-called-1');
    const prev2 = document.getElementById('prev-called-2');
    if (allCalled.length > 1 && prev1) {
        const p1 = allCalled[allCalled.length - 2];
        prev1.textContent = getLetter(p1) + p1;
    }
    if (allCalled.length > 2 && prev2) {
        const p2 = allCalled[allCalled.length - 3];
        prev2.textContent = getLetter(p2) + p2;
    }

    const countEl = document.getElementById('called-count');
    if (countEl) countEl.textContent = `${allCalled.length}/75`;

    const cells = document.querySelectorAll('.bingo-cell');
    cells.forEach(cell => {
        const cellValue = cell.textContent.trim();
        if (cellValue !== 'FREE' && parseInt(cellValue) === num) {
            cell.classList.add('marked', 'last-called-cell');
            
            // Highlight the cell that was just called
            setTimeout(() => {
                cell.classList.remove('last-called-cell');
            }, 3000);
        }
    });

    // Auto-check for win after marking
    if (selectedCardId && checkWin(selectedCardId, allCalled)) {
        const bingoBtn = document.getElementById('bingo-btn');
        if (bingoBtn) {
            bingoBtn.classList.add('blink-alert');
            bingoBtn.disabled = false;
        }
    }
}

function getLetter(num) {
    if (num <= 15) return 'B';
    if (num <= 30) return 'I';
    if (num <= 45) return 'N';
    if (num <= 60) return 'G';
    return 'O';
}

function generateCardGrid() {
    const grid = document.getElementById('card-selection-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    for (let i = 1; i <= 100; i++) {
        const btn = document.createElement('div');
        btn.className = 'card-item';
        btn.textContent = i;
        if (selectedCardId === i) btn.classList.add('selected');
        btn.onclick = () => showCardPreview(i);
        grid.appendChild(btn);
    }
}

function modernAlert(message, title = 'Chewatabingo') {
    const overlay = document.createElement('div');
    overlay.className = 'modern-alert-overlay';
    overlay.innerHTML = `
        <div class="modern-alert">
            <h3>${title}</h3>
            <p>${message}</p>
            <button class="modern-alert-btn">OK</button>
        </div>
    `;
    document.body.appendChild(overlay);
    return new Promise((resolve) => {
        overlay.querySelector('.modern-alert-btn').onclick = () => {
            document.body.removeChild(overlay);
            resolve();
        };
    });
}

function showCardPreview(cardId) {
    const modal = document.getElementById('card-preview-modal');
    const title = document.getElementById('preview-card-title');
    const grid = document.getElementById('preview-card-grid');
    if (!modal || !BINGO_CARDS[cardId]) return;
    title.textContent = `Card #${cardId}`;
    grid.innerHTML = '';
    const cardData = BINGO_CARDS[cardId];
    cardData.forEach(row => {
        row.forEach(num => {
            const cell = document.createElement('div');
            cell.className = 'preview-cell';
            cell.textContent = num === 0 ? 'FREE' : num;
            grid.appendChild(cell);
        });
    });
    modal.style.display = 'flex';
    document.getElementById('preview-confirm-btn').onclick = async () => {
        modal.style.display = 'none';
        selectedCardId = cardId;
        
        const cardItems = document.querySelectorAll('.card-item');
        cardItems.forEach(item => {
            item.classList.remove('selected');
            if (parseInt(item.textContent) === cardId) {
                item.classList.add('selected');
            }
        });

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'select_card', cardId: cardId }));
        }
        await modernAlert(`ካርድ #${cardId} ተይዟል! አሁን መጫወት ይችላሉ።`, 'ተመርጧል');
    };
    document.getElementById('preview-back-btn').onclick = () => {
        modal.style.display = 'none';
    };
}

function initializeGlobalMenu() {
    const trigger = document.getElementById('menu-trigger');
    const logoTrigger = document.querySelector('.header-logo');
    const closeBtn = document.getElementById('close-menu');
    const menu = document.getElementById('side-menu');
    
    if (trigger && menu) trigger.onclick = () => menu.classList.add('active');
    
    // Admin access via double-tap on logo
    if (logoTrigger) {
        let lastTap = 0;
        logoTrigger.addEventListener('touchend', (e) => {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTap;
            if (tapLength < 500 && tapLength > 0) {
                showAdminPrompt();
                e.preventDefault();
            }
            lastTap = currentTime;
        });
        logoTrigger.addEventListener('dblclick', () => {
            showAdminPrompt();
        });
    }

    const adminSubmit = document.getElementById('admin-prompt-submit');
    const adminCancel = document.getElementById('admin-prompt-cancel');
    const adminInput = document.getElementById('admin-chat-id-input');
    const adminModal = document.getElementById('admin-prompt-modal');

    if (adminSubmit) {
        adminSubmit.onclick = async () => {
            const chatId = adminInput.value;
            if (!chatId) return;

            try {
                const res = await fetch('/api/admin/verify-id', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chatId })
                });
                const data = await res.json();
                if (data.success) {
                    localStorage.setItem('bingo_admin_token', data.token);
                    window.location.href = '/admin';
                } else {
                    modernAlert('የተሳሳተ የአድሚን መለያ ቁጥር!');
                }
            } catch (e) {
                modernAlert('ስህተት ተከስቷል');
            }
        };
    }

    if (adminCancel) {
        adminCancel.onclick = () => {
            adminModal.style.display = 'none';
            adminInput.value = '';
        };
    }

    function showAdminPrompt() {
        if (adminModal) adminModal.style.display = 'flex';
    }

    if (closeBtn && menu) closeBtn.onclick = () => menu.classList.remove('active');
    document.querySelectorAll('.menu-item').forEach(item => {
        item.onclick = () => {
            const target = item.dataset.target;
            if (target === 'home') {
                showScreen('selection-screen');
            }
            else if (target === 'profile') { 
                showScreen('profile-screen'); 
                loadProfile(); 
            }
            else if (target === 'wallet') showScreen('wallet-screen');
            else if (target === 'referral') showInviteModal();
            else if (target === 'admin') window.location.href = '/admin';
            menu.classList.remove('active');
        };
    });

    // Referral menu item handler
    const referralMenuItem = document.getElementById('referral-menu-item');
    if (referralMenuItem) {
        referralMenuItem.onclick = () => {
            showInviteModal();
            menu.classList.remove('active');
        };
    }

    // Close invite modal
    const closeInviteBtn = document.querySelector('.close-invite');
    if (closeInviteBtn) {
        closeInviteBtn.onclick = () => {
            document.getElementById('invite-modal').style.display = 'none';
        };
    }

    // Copy invite link
    const copyInviteLinkBtn = document.getElementById('copy-invite-link');
    if (copyInviteLinkBtn) {
        copyInviteLinkBtn.onclick = () => {
            const linkInput = document.getElementById('invite-link-input');
            if (linkInput) {
                navigator.clipboard.writeText(linkInput.value).then(() => {
                    modernAlert('ሊንኩ ተገልብጧል!', 'ተገለበጠ');
                }).catch(() => {
                    linkInput.select();
                    document.execCommand('copy');
                    modernAlert('ሊንኩ ተገልብጧል!', 'ተገለበጠ');
                });
            }
        };
    }
}

function showInviteModal() {
    const modal = document.getElementById('invite-modal');
    if (modal) {
        modal.style.display = 'flex';
        loadReferralStats();
        updateReferralLink();
    }
}

function updateReferralLink() {
    const user = JSON.parse(localStorage.getItem('bingo_user') || '{}');
    const linkInput = document.getElementById('invite-link-input');
    if (linkInput && user.id) {
        const baseUrl = window.location.origin;
        linkInput.value = `${baseUrl}?ref=${user.id}`;
    }
}

async function loadReferralStats() {
    const token = localStorage.getItem('bingo_token');
    if (!token) return;

    try {
        const res = await fetch('/api/referral-stats', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        const totalReferralsEl = document.getElementById('total-referrals');
        const totalEarningsEl = document.getElementById('total-referral-earnings');
        
        if (totalReferralsEl) totalReferralsEl.textContent = data.totalReferrals || 0;
        if (totalEarningsEl) totalEarningsEl.textContent = (data.totalEarnings || 0) + ' ETB';
    } catch (err) {
        console.error('Error loading referral stats:', err);
    }
}

function loadWallet() {
    const token = localStorage.getItem('bingo_token');
    if (!token) return;

    fetch('/api/profile', {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
        if (data.balance !== undefined) {
            const walletBalanceEl = document.getElementById('wallet-balance-value');
            const mainWalletValueEl = document.getElementById('main-wallet-value');
            if (walletBalanceEl) walletBalanceEl.textContent = parseFloat(data.balance).toFixed(2);
            if (mainWalletValueEl) mainWalletValueEl.textContent = parseFloat(data.balance).toFixed(2);
        }
    })
    .catch(err => console.error('Error loading wallet:', err));
}

function showScreen(screenId) {
    const screens = ['landing-screen', 'stake-screen', 'register-screen', 'otp-screen', 'selection-screen', 'profile-screen', 'wallet-screen', 'game-screen', 'auth-screen', 'deposit-screen', 'withdraw-screen'];
    screens.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === screenId) ? 'flex' : 'none';
    });

    if (screenId === 'wallet-screen') {
        loadWallet();
        loadTransactions();
    }
}

async function loadTransactions() {
    const token = localStorage.getItem('bingo_token');
    if (!token) return;

    try {
        const res = await fetch('/api/transactions', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const list = document.getElementById('transaction-list');
        if (!list) return;

        if (data.length === 0) {
            list.innerHTML = '<div class="no-transactions">No transactions yet</div>';
            return;
        }

        list.innerHTML = data.map(tx => `
            <div class="transaction-item">
                <div class="tx-info">
                    <span class="tx-type ${tx.type}">${tx.type.toUpperCase()}</span>
                    <span class="tx-date">${new Date(tx.created_at).toLocaleDateString()}</span>
                </div>
                <div class="tx-amount ${tx.amount > 0 ? 'positive' : 'negative'}">
                    ${tx.amount > 0 ? '+' : ''}${tx.amount} ETB
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Error loading transactions:', e);
    }
}

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    ws.onopen = () => {
        const user = JSON.parse(localStorage.getItem('bingo_user')) || { 
            id: 'anon_' + Math.random().toString(36).substr(2, 9),
            username: 'Guest_' + Math.floor(Math.random() * 1000)
        };
        ws.send(JSON.stringify({ type: 'init', userId: user.id, username: user.username }));
        if (selectedCardId) ws.send(JSON.stringify({ type: 'select_card', cardId: selectedCardId }));
    };
    ws.onmessage = (event) => {
        console.log('WS Received:', event.data);
        const data = JSON.parse(event.data);
        if (data.type === 'timer') updateTimerDisplay(data.timeLeft, data.status);
        else if (data.type === 'selection_update') {
            updateTakenCards(data.takenCards);
            updateGameStats(data.playerCount, data.prizePool);
        }
        else if (data.type === 'bingo_rejected') {
            hideCheckingOverlay();
            modernAlert(data.reason, 'ውድቅ ተደርጓል');
        }
        else if (data.type === 'number_called') {
            updateCalledNumbers(data.number, data.allCalled);
        } else if (data.type === 'game_start') {
            hideCheckingOverlay();
            updateGameStats(data.playerCount, data.prizePool);
            if (selectedCardId) {
                showScreen('game-screen');
                initMasterGrid();
                renderPlayerCard(selectedCardId);
                const bingoBtn = document.getElementById('bingo-btn');
                if (bingoBtn) {
                    bingoBtn.classList.remove('blink-alert');
                    bingoBtn.disabled = false;
                    bingoBtn.onclick = () => {
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'call_bingo' }));
                        }
                    };
                }
            }
        } else if (data.type === 'game_end') {
            hideCheckingOverlay();
            showSelectionScreen();
            selectedCardId = null;
            modernAlert('Game finished! Select your card for the next round.', 'Round Over');
        } else if (data.type === 'bingo_checking') {
            showCheckingOverlay(data.username);
        } else if (data.type === 'bingo_check_failed') {
            hideCheckingOverlay();
        } else if (data.type === 'winner') {
            console.log('WINNER DATA RECEIVED:', data);
            
            // Highlight winning numbers on the card
            if (data.winLines && selectedCardId === data.cardId) {
                const cells = document.querySelectorAll('.bingo-cell');
                data.winLines.forEach(line => {
                    line.cells.forEach(pos => {
                        const index = pos.r * 5 + pos.c;
                        if (cells[index]) {
                            cells[index].classList.add('win-blink', 'winner-cell');
                        }
                    });
                });
            }
            
            // Highlight the specific winning line visually if it was the last called number
            // (The request asked to highlight the last called number on the winning line)
            
            confetti({ particleCount: 200, spread: 80, origin: { y: 0.6 } });
            showWinnerModal(data);
            
            // Refresh wallet balance after win
            setTimeout(loadWallet, 2000);
        } else if (data.type === 'game_reset') {
            console.log('GAME RESET RECEIVED');
            hideCheckingOverlay();
            
            // Remove winner modal if it exists
            const overlays = document.querySelectorAll('.winner-modal-overlay');
            overlays.forEach(o => o.remove());
            
            selectedCardId = null;
            showSelectionScreen();
            
            // Clear any win-blink styles from cells
            const cells = document.querySelectorAll('.bingo-cell');
            cells.forEach(c => c.classList.remove('win-blink', 'winner-cell', 'marked', 'last-called-cell'));
            
            updateTimerDisplay(data.timeLeft, data.status);
        } else if (data.type === 'card_confirmed') {
            selectedCardId = data.cardId;
            const walletBalanceEl = document.getElementById('wallet-balance-value');
            const mainWalletValueEl = document.getElementById('main-wallet-value');
            if (walletBalanceEl) walletBalanceEl.textContent = data.newBalance.toFixed(2);
            if (mainWalletValueEl) mainWalletValueEl.textContent = data.newBalance.toFixed(2);
            modernAlert(`ካርድ #${data.cardId} ተይዟል! 10 ብር ተቀንሷል።`, 'ተመርጧል');
        } else if (data.type === 'error') {
            modernAlert(data.message, 'ስህተት');
        }
    };
}

function showCheckingOverlay(username) {
    let overlay = document.getElementById('checking-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'checking-overlay';
        overlay.className = 'winner-modal-overlay'; // Reuse styling
        overlay.innerHTML = `
            <div class="winner-card checking-card">
                <div class="checking-spinner"></div>
                <h2 class="winner-title" style="color: #00c8ff;">CHECKING...</h2>
                <p style="color: white; font-size: 1.2em;">${username} ቢንጎ ብሏል! ሲስተሙ እያረጋገጠ ነው...</p>
            </div>
        `;
        document.body.appendChild(overlay);
    }
}

function hideCheckingOverlay() {
    const overlay = document.getElementById('checking-overlay');
    if (overlay) overlay.remove();
}

function showWinnerModal(data) {
    // Highlight winning lines on current player card if they are the winner
    if (selectedCardId === data.cardId) {
        const cells = document.querySelectorAll('.bingo-cell');
        data.winLines.forEach(line => {
            line.cells.forEach(pos => {
                const index = pos.r * 5 + pos.c;
                if (cells[index]) {
                    cells[index].classList.add('win-blink');
                }
            });
        });
    }

    const overlay = document.createElement('div');
    overlay.className = 'winner-modal-overlay';
    overlay.innerHTML = `
        <div class="winner-card">
            <div class="winner-crown">👑</div>
            <h2 class="winner-title">BINGO WINNER!</h2>
            <div class="winner-info">
                <div class="winner-field">
                    <span class="field-label">PLAYER</span>
                    <span class="field-value">${data.username}</span>
                </div>
                <div class="winner-field">
                    <span class="field-label">CARD #</span>
                    <span class="field-value">${data.cardId}</span>
                </div>
                <div class="winner-field prize">
                    <span class="field-label">PRIZE</span>
                    <span class="field-value">${data.prize} ETB</span>
                </div>
            </div>
            <div class="winner-preview-card" id="winner-preview-card"></div>
            <button class="winner-close-btn">Continue</button>
        </div>
    `;
    document.body.appendChild(overlay);

    // Render a small preview of the winning card
    const previewContainer = overlay.querySelector('#winner-preview-card');
    const cardData = BINGO_CARDS[data.cardId];
    cardData.forEach((row, r) => {
        row.forEach((num, c) => {
            const cell = document.createElement('div');
            cell.className = 'mini-cell';
            if (num === 0) cell.classList.add('free');
            
            // Check if this cell is part of a win line
            const isWinCell = data.winLines.some(line => 
                line.cells.some(pos => pos.r === r && pos.c === c)
            );
            if (isWinCell) cell.classList.add('win');
            
            cell.textContent = num === 0 ? 'F' : num;
            previewContainer.appendChild(cell);
        });
    });

    overlay.querySelector('.winner-close-btn').onclick = () => {
        document.body.removeChild(overlay);
        showSelectionScreen();
    };
}

async function loadProfile() {
    const token = localStorage.getItem('bingo_token');
    if (!token) return;

    try {
        const res = await fetch('/api/profile', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (data.id) {
            // Map database fields to UI
            const nameEl = document.getElementById('profile-name');
            const usernameHeaderEl = document.getElementById('profile-username-header');
            const idEl = document.getElementById('profile-id-sub');
            const telegramIdEl = document.getElementById('profile-telegram-id');
            const balanceEl = document.getElementById('profile-balance');
            const depositEl = document.getElementById('profile-deposit-balance');
            const winEl = document.getElementById('profile-win-balance');
            const gamesEl = document.getElementById('profile-total-games');
            const winsEl = document.getElementById('profile-wins');
            const avatarLetterEl = document.getElementById('profile-avatar-letter');

            const username = data.username || 'N/A';
            if (nameEl) nameEl.textContent = username;
            if (usernameHeaderEl) usernameHeaderEl.textContent = username;
            if (avatarLetterEl) avatarLetterEl.textContent = username.charAt(0).toUpperCase();
            
            if (idEl) idEl.textContent = `ID: ${data.telegram_id || data.id || '---'}`;
            if (telegramIdEl) telegramIdEl.textContent = data.telegram_id || '---';
            
            if (balanceEl) balanceEl.textContent = `${parseFloat(data.balance || 0).toFixed(2)} ETB`;
            if (depositEl) depositEl.textContent = `${parseFloat(data.deposit_balance || 0).toFixed(2)} ETB`;
            if (winEl) winEl.textContent = `${parseFloat(data.win_balance || 0).toFixed(2)} ETB`;
            if (gamesEl) gamesEl.textContent = data.total_games || 0;
            if (winsEl) winsEl.textContent = data.total_wins || 0;
        }
    } catch (e) {
        console.error('Error loading profile:', e);
    }
}

function checkWin(cardId, markedNumbers) {
    const cardData = BINGO_CARDS[cardId];
    if (!cardData) return false;
    const isMarked = (r, c) => {
        const num = cardData[r][c];
        return num === 0 || markedNumbers.includes(num);
    };
    for (let r = 0; r < 5; r++) {
        let win = true;
        for (let c = 0; c < 5; c++) if (!isMarked(r, c)) { win = false; break; }
        if (win) return true;
    }
    for (let c = 0; c < 5; c++) {
        let win = true;
        for (let r = 0; r < 5; r++) if (!isMarked(r, c)) { win = false; break; }
        if (win) return true;
    }
    let d1 = true, d2 = true;
    for (let i = 0; i < 5; i++) {
        if (!isMarked(i, i)) d1 = false;
        if (!isMarked(i, 4 - i)) d2 = false;
    }
    if (d1 || d2) return true;
    if (isMarked(0, 0) && isMarked(0, 4) && isMarked(4, 0) && isMarked(4, 4)) return true;
    if (isMarked(1, 2) && isMarked(3, 2) && isMarked(2, 1) && isMarked(2, 3)) return true;
    return false;
}

function initializeAuth() {
    const logoutBtn = document.getElementById('logout-menu-item');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            localStorage.removeItem('bingo_token');
            localStorage.removeItem('bingo_user');
            location.reload();
        };
    }
    
    const token = localStorage.getItem('bingo_token');
    if (token) {
        loadProfile();
    }
}

async function loadWallet() {
    const token = localStorage.getItem('bingo_token');
    if (!token) return;
    try {
        const res = await fetch('/api/profile', { 
            headers: { 'Authorization': `Bearer ${token}` },
            cache: 'no-store'
        });
        if (res.ok) {
            const user = await res.json();
            const walletBalanceEl = document.getElementById('wallet-balance-value');
            const mainWalletValueEl = document.getElementById('main-wallet-value');
            
            const balance = parseFloat(user.balance || 0).toFixed(2);
            if (walletBalanceEl) walletBalanceEl.textContent = balance;
            if (mainWalletValueEl) mainWalletValueEl.textContent = balance;
            
            // Update detailed balances for wallet screen
            const depositEl = document.getElementById('wallet-deposit-value');
            const winEl = document.getElementById('wallet-win-value');
            if (depositEl) depositEl.textContent = parseFloat(user.deposit_balance || 0).toFixed(2);
            if (winEl) winEl.textContent = parseFloat(user.win_balance || 0).toFixed(2);

            // Update withdrawal requirements in UI
            const reqDeposit = document.getElementById('req-deposit');
            const reqWins = document.getElementById('req-wins');
            const withdrawBtn = document.getElementById('submit-withdraw-btn');

            // We need total deposits for the UI, adding it to the profile API or calculating here if we had the data
            // For now, let's assume we'll update the profile API to include this info or show based on what we have
            // To be precise, let's update the Profile API in server.js to include total_deposited
            
            const totalDeposited = parseFloat(user.total_deposited || 0);
            const totalWins = parseInt(user.total_wins || 0);

            if (reqDeposit) {
                reqDeposit.textContent = `ቢያንስ 100 ብር ዲፖዚት ማድረግ (${totalDeposited}/100)`;
                reqDeposit.style.color = totalDeposited >= 100 ? '#22c55e' : '#ef4444';
            }
            if (reqWins) {
                reqWins.textContent = `ቢያንስ 2 ጊዜ ማሸነፍ (${totalWins}/2)`;
                reqWins.style.color = totalWins >= 2 ? '#22c55e' : '#ef4444';
            }

            if (withdrawBtn) {
                if (totalDeposited < 100 || totalWins < 2) {
                    withdrawBtn.disabled = true;
                    withdrawBtn.style.opacity = '0.5';
                    withdrawBtn.title = 'መስፈርቶቹን አላሟሉም';
                } else {
                    withdrawBtn.disabled = false;
                    withdrawBtn.style.opacity = '1';
                }
            }

            // Also update transaction list
            loadTransactions();
        }
    } catch (e) {
        console.error('Failed to load wallet', e);
    }
}

async function loadProfile() {
    const token = localStorage.getItem('bingo_token');
    if (!token) return;
    try {
        const res = await fetch('/api/profile', {
            headers: { 'Authorization': `Bearer ${token}` },
            cache: 'no-store'
        });
        if (res.ok) {
            const data = await res.json();
            
            const usernameEl = document.getElementById('profile-username-header');
            const idEl = document.getElementById('profile-id-sub');
            const tgIdEl = document.getElementById('profile-telegram-id');
            const balanceEl = document.getElementById('profile-balance');
            const depositEl = document.getElementById('profile-deposit-balance');
            const winEl = document.getElementById('profile-win-balance');
            const gamesEl = document.getElementById('profile-total-games');
            const winsEl = document.getElementById('profile-wins');
            const avatarEl = document.getElementById('profile-avatar-letter');

            if (usernameEl) usernameEl.textContent = data.username;
            if (idEl) idEl.textContent = `ID: ${data.id}`;
            if (tgIdEl) tgIdEl.textContent = data.telegram_id;
            if (balanceEl) balanceEl.textContent = `${parseFloat(data.balance || 0).toFixed(2)} ETB`;
            if (depositEl) depositEl.textContent = `${parseFloat(data.deposit_balance || 0).toFixed(2)} ETB`;
            if (winEl) winEl.textContent = `${parseFloat(data.win_balance || 0).toFixed(2)} ETB`;
            if (gamesEl) gamesEl.textContent = data.total_games || 0;
            if (winsEl) winsEl.textContent = data.total_wins || 0;
            if (avatarEl && data.username) avatarEl.textContent = data.username.charAt(0).toUpperCase();

            // Update user in local storage
            localStorage.setItem('bingo_user', JSON.stringify(data));
        }
    } catch (e) {
        console.error('Failed to load profile', e);
    }
}

async function loadTransactions() {
    const token = localStorage.getItem('bingo_token');
    if (!token) return;
    try {
        const res = await fetch('/api/transactions', { 
            headers: { 'Authorization': `Bearer ${token}` },
            cache: 'no-store'
        });
        if (res.ok) {
            const txs = await res.json();
            const list = document.getElementById('transaction-list');
            if (!list) return;
            
            if (txs.length === 0) {
                list.innerHTML = '<div class="no-transactions">ምንም የሒሳብ እንቅስቃሴ የለም</div>';
                return;
            }
            
            list.innerHTML = txs.map(tx => {
                const isPositive = tx.type === 'deposit' || tx.type === 'win' || tx.type === 'admin_credit' || tx.type === 'referral';
                return `
                <div class="transaction-item">
                    <div class="tx-info">
                        <span class="tx-type">${isPositive ? '📥 ገቢ' : '📤 ወጪ'}</span>
                        <span class="tx-date">${new Date(tx.created_at).toLocaleDateString()}</span>
                    </div>
                    <div class="tx-amount ${isPositive ? 'positive' : 'negative'}">
                        ${isPositive ? '+' : '-'}${parseFloat(tx.amount).toFixed(2)} ETB
                    </div>
                </div>
                `;
            }).join('');
        }
    } catch (e) {
        console.error('Failed to load transactions', e);
    }
}

async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        if (res.ok) {
            const config = await res.json();
            window.botUsername = config.botUsername;
            
            // Update landing screen join button
            const joinBtn = document.querySelector('.tg-join-btn');
            if (joinBtn) {
                joinBtn.href = `https://t.me/${config.botUsername}`;
            }

            // Update invite links if they exist in the UI
            updateInviteLinks();
        }
    } catch (e) {
        console.error('Failed to load config', e);
    }
}

function updateInviteLinks() {
    const userJson = localStorage.getItem('bingo_user');
    if (userJson && window.botUsername) {
        const user = JSON.parse(userJson);
        const inviteInput = document.getElementById('invite-link-input');
        if (inviteInput) {
            inviteInput.value = `https://t.me/${window.botUsername}?start=${user.id}`;
        }
    }
}

// Update menu trigger to use new loadWallet
document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    document.querySelectorAll('.menu-item').forEach(item => {
        const oldClick = item.onclick;
        item.onclick = () => {
            const target = item.dataset.target;
            if (target === 'wallet') {
                showScreen('wallet-screen');
                loadWallet();
            }
            if (oldClick) oldClick();
        };
    });

    document.querySelectorAll('.footer-btn').forEach(btn => {
        btn.onclick = () => {
            const target = btn.dataset.target;
            if (target === 'wallet') {
                showScreen('wallet-screen');
                loadWallet();
            } else if (target === 'profile') {
                showScreen('profile-screen');
                loadProfile();
            } else if (target === 'game') {
                if (gameStatus === 'playing' && selectedCardId) {
                    showScreen('game-screen');
                } else {
                    showSelectionScreen();
                }
            }
            
            document.querySelectorAll('.footer-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        };
    });
});

// Ensure the refresh button works
document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('profile-refresh-btn');
    if (refreshBtn) {
        refreshBtn.onclick = () => {
            refreshBtn.classList.add('rotating');
            loadProfile().finally(() => {
                setTimeout(() => refreshBtn.classList.remove('rotating'), 500);
            });
        };
    }
});