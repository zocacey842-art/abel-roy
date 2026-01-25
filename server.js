require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws'); 
const path = require('path');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' });
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api'); 

const db = require('./db/database');
const User = require('./models/User');
const Wallet = require('./models/Wallet');
const Game = require('./models/Game');
const { validateBingo } = require('./data/cards');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    keepalive: true
});

const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '604812345';
const JWT_SECRET = process.env.JWT_SECRET || 'chewatabingo-secret-key';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const MINI_APP_URL = process.env.RENDER_EXTERNAL_URL || process.env.MINI_APP_URL || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://royal-bingo.onrender.com");

let bot = null;
if (TELEGRAM_BOT_TOKEN) {
    console.log('[BOT] Initializing with Webhook...');
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

    const WEBHOOK_PATH = `/telegram-webhook-${TELEGRAM_BOT_TOKEN.slice(-10)}`;
    const WEBHOOK_URL = MINI_APP_URL + WEBHOOK_PATH;

    console.log(`[BOT] Attempting to set webhook to: ${WEBHOOK_URL}`);
    bot.setWebHook(WEBHOOK_URL, {
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true
    })
        .then(() => {
            console.log(`[BOT] Webhook successfully set to: ${WEBHOOK_URL}`);
            // Remove fallback polling to ensure webhook is used
        })
        .catch(err => {
            console.error('[BOT] Webhook setup failed:', err.message);
        });

    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const currentDomain = MINI_APP_URL || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://royal-bingo.onrender.com");
        const welcomeMessage = `እንኳን ወደ ROYAL BINGO በደህና መጡ! 👑\n\nይህ የእርሶ የቴሌግራም መለያ መለያ ቁጥር (Chat ID) ነው (ለመገልበጥ ቁጥሩን ይጫኑ)፡\n🆔 \`` + chatId + `\`\n\nይህንን ቁጥር በመጠቀም በዌብሳይቱ ላይ መመዝገብ ይችላሉ፡፡\n\nመልካም ጨዋታ!`;
        
        const opts = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "🎮 ጨዋታውን ጀምር (Open App)",
                            web_app: { url: currentDomain }
                        }
                    ]
                ]
            }
        };

        bot.sendMessage(chatId, welcomeMessage, opts).catch(err => console.error('[BOT] Start message failed:', err));
    });

    // Endpoint for Telegram Webhook
    app.post(WEBHOOK_PATH, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });
}

app.post('/api/admin/verify-id', async (req, res) => {
    const { chatId } = req.body;
    if (!chatId) return res.status(400).json({ error: 'Chat ID required' });

    console.log(`[ADMIN] Login attempt for ID: ${chatId}, Expected: ${ADMIN_CHAT_ID}`);

    if (chatId.toString().trim() === ADMIN_CHAT_ID.toString().trim()) {
        const token = jwt.sign({ isAdmin: true }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ error: 'Invalid Admin ID' });
    }
});

const adminAuthMiddleware = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.isAdmin || decoded.userId) { // Check for admin status or user ID (backend will check ID later)
            req.user = decoded;
            next();
        } else {
            res.status(403).json({ error: 'Access denied' });
        }
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// authMiddleware definition
const authMiddleware = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// --- Web API ---
app.post('/api/deposit', authMiddleware, async (req, res) => {
    const { amount, transactionId, method, smsText } = req.body;
    try {
        if (!amount || !transactionId || !method) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        const depositAmount = parseFloat(amount);
        if (depositAmount < 30) {
            return res.status(400).json({ error: 'ዝቅተኛው የዲፖዚት መጠን 30 ብር ነው!' });
        }

        const result = await pool.query(
            'INSERT INTO deposits (user_id, amount, confirmation_code, payment_method, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [req.user.userId, amount, transactionId, method, 'pending']
        );
        
        if (bot) {
            const adminMsg = `💰 *አዲስ የዲፖዚት ጥያቄ*\n\nተጠቃሚ: ${req.user.username}\nመጠን: ${amount} ETB\n트ራንዛክሽን ID: ${transactionId}\nመንገድ: ${method}\n\n*ሙሉ ቴክስት:*\n\`${smsText || 'ያልተገለጸ'}\``;
            bot.sendMessage(ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' }).catch(err => console.error('Admin notify error:', err));
        }
        
        res.json({ success: true, depositId: result.rows[0].id });
    } catch (err) {
        console.error('Deposit Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/withdraw', authMiddleware, async (req, res) => {
    const { amount, method, accountDetails } = req.body;
    try {
        if (!amount || !method || !accountDetails) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Check constraints: min 100 ETB deposit history and 2 wins
        const depositCheck = await pool.query(
            "SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE user_id = $1 AND status = 'completed'",
            [req.user.userId]
        );
        const winCheck = await pool.query(
            "SELECT COUNT(*) FROM winners WHERE user_id = $1",
            [req.user.userId]
        );

        const totalDeposited = parseFloat(depositCheck.rows[0].total);
        const winCount = parseInt(winCheck.rows[0].count);

        if (totalDeposited < 100) {
            return res.status(400).json({ error: 'ገንዘብ ለማውጣት ቢያንስ 100 ብር ዲፖዚት ማድረግ ይኖርብዎታል!' });
        }
        if (winCount < 2) {
            return res.status(400).json({ error: 'ገንዘብ ለማውጣት ቢያንስ 2 ጊዜ ማሸነፍ ይኖርብዎታል!' });
        }

        const wallet = await Wallet.getBalance(req.user.userId);
        if (wallet.win < amount) {
            return res.status(400).json({ error: 'ሊወጣ የሚችል በቂ የዊን ባላንስ (Win Balance) የለዎትም!' });
        }

        const result = await Wallet.withdraw(req.user.userId, amount, `Withdrawal to ${method}: ${accountDetails}`);
        
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        if (bot) {
            const adminMsg = `💸 *አዲስ የዊዝድሮው ጥያቄ*\n\nተጠቃሚ: ${req.user.username}\nመጠን: ${amount} ETB\nመንገድ: ${method}\nዝርዝር: ${accountDetails}`;
            bot.sendMessage(ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' }).catch(err => console.error('Admin notify error:', err));
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Withdraw Error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/request-otp', async (req, res) => {
    const { username, telegramId, password, referrerId } = req.body;
    try {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        // Save OTP
        await pool.query(
            'INSERT INTO otp_verification (telegram_id, otp_code, expires_at) VALUES ($1, $2, $3)',
            [telegramId, otp, expires]
        );

        const hashedPassword = await require('bcryptjs').hash(password, 10);
        const userCheck = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
        
        // Use referrerId from session/body if available
        const finalReferrerId = referrerId || null;

        if (userCheck.rows.length === 0) {
            await pool.query(
                'INSERT INTO users (username, telegram_id, password, is_registered, referred_by) VALUES ($1, $2, $3, false, $4)',
                [username, telegramId, hashedPassword, finalReferrerId]
            );
        } else {
            await pool.query(
                'UPDATE users SET username = $1, password = $2, referred_by = COALESCE(referred_by, $4) WHERE telegram_id = $3',
                [username, hashedPassword, telegramId, finalReferrerId]
            );
        }

        if (bot) {
            try {
                const message = `የሮያል ቢንጎ ማረጋገጫ ኮድ (ለመገልበጥ ቁጥሩን ይጫኑ)፡ \`${otp}\` \nይህ ኮድ ለ 5 ደቂቃ ብቻ ያገለግላል፡፡`;
                await bot.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
            } catch (botErr) {
                console.warn('Bot failed to send message, but continuing registration:', botErr.message);
            }
        }
        res.json({ success: true });
    } catch (err) {
        console.error('OTP Error:', err);
        res.json({ success: true });
    }
});

app.post('/api/verify-registration', async (req, res) => {
    const { telegramId, otp } = req.body;
    try {
        const otpCheck = await pool.query(
            'SELECT * FROM otp_verification WHERE telegram_id = $1 AND otp_code = $2 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
            [telegramId, otp]
        );

        if (otpCheck.rows.length === 0) {
            return res.status(400).json({ error: 'የተሳሳተ ወይም ጊዜው ያለፈበት ኮድ!' });
        }

        await pool.query('UPDATE users SET is_registered = true WHERE telegram_id = $1', [telegramId]);
        const userResult = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
        const user = userResult.rows[0];

        // Check wallet
        const walletCheck = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [user.id]);
        if (walletCheck.rows.length === 0) {
            await pool.query('INSERT INTO wallets (user_id, deposit_balance) VALUES ($1, 20.00)', [user.id]);
        }

        // Process referral bonus - give referrer 2 ETB
        if (user.referred_by) {
            const referrerCheck = await pool.query('SELECT id FROM users WHERE id = $1', [user.referred_by]);
            if (referrerCheck.rows.length > 0) {
                const referrerId = referrerCheck.rows[0].id;
                // Check if referral bonus already given
                const existingReferral = await pool.query(
                    'SELECT id FROM referrals WHERE referrer_id = $1 AND referred_id = $2',
                    [referrerId, user.id]
                );
                if (existingReferral.rows.length === 0) {
                    // Add referral bonus to referrer
                    await pool.query('UPDATE wallets SET deposit_balance = deposit_balance + 2.00 WHERE user_id = $1', [referrerId]);
                    // Record referral
                    await pool.query(
                        'INSERT INTO referrals (referrer_id, referred_id, bonus_amount) VALUES ($1, $2, 2.00)',
                        [referrerId, user.id]
                    );
                    // Record transaction for referrer
                    await pool.query(
                        'INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, 2.00, $2, $3)',
                        [referrerId, 'referral', `Referral bonus for inviting ${user.username}`]
                    );
                    // Notify referrer via Telegram if bot is available
                    if (bot) {
                        const referrerInfo = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [referrerId]);
                        if (referrerInfo.rows.length > 0 && referrerInfo.rows[0].telegram_id) {
                            bot.sendMessage(referrerInfo.rows[0].telegram_id, 
                                `🎉 እንኳን ደስ አሎት! ${user.username} በሪፈራል ሊንክዎ ተመዝግቧል፡፡ 2 ብር ቦነስ አግኝተዋል!`
                            ).catch(err => console.error('Referral notification error:', err.message));
                        }
                    }
                }
            }
        }

        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);
        
        // Notify user via Telegram
        if (bot) {
            const currentDomain = MINI_APP_URL || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://royal-bingo.onrender.com");
            const welcomeMessage = `እንኳን ደስ አሎት! 🎉\n\nምዝገባዎ በተሳካ ሁኔታ ተጠናቋል፡፡ የ 20 ብር የመመዝገቢያ ቦነስ ወደ አካውንትዎ ገብቷል፡፡ አሁን ተወዳጁን ሮያል ቢንጎን መጫወት ይችላሉ፡፡\n\nመልካም እድል! 👑`;
            
            const opts = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "🎮 አሁኑኑ ይጫወቱ (Play Now)",
                                web_app: { url: currentDomain }
                            }
                        ]
                    ]
                }
            };
            bot.sendMessage(telegramId, welcomeMessage, opts).catch(err => console.error('[BOT] Welcome notification failed:', err.message));
        }

        res.json({ success: true, token, user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/register', async (req, res) => {
    const { username, password, phone } = req.body;
    try {
        const hashedPassword = await require('bcryptjs').hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, password, phone_number, is_registered) VALUES ($1, $2, $3, true) RETURNING id',
            [username, hashedPassword, phone]
        );
        const userId = result.rows[0].id;
        await pool.query('INSERT INTO wallets (user_id, deposit_balance) VALUES ($1, 20.00)', [userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { telegramId, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'ተጠቃሚው አልተገኘም' });

        const user = result.rows[0];
        const bcrypt = require('bcryptjs');
        const valid = await bcrypt.compare(password, user.password || '');
        if (!valid) return res.status(401).json({ error: 'የተሳሳተ የይለፍ ቃል' });

        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);
        res.json({ success: true, token, user });
    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// authMiddleware already defined above

app.get('/api/config', (req, res) => {
    res.json({
        botUsername: process.env.TELEGRAM_BOT_USERNAME || 'RoyalBingoBot'
    });
});

app.get('/api/profile', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                u.id, u.username, u.telegram_id, u.phone_number, u.created_at,
                (w.deposit_balance + w.win_balance) as balance,
                w.deposit_balance, w.win_balance,
                (SELECT COUNT(*) FROM game_participants WHERE user_id = u.id) as total_games,
                (SELECT COUNT(*) FROM winners WHERE user_id = u.id) as total_wins,
                (SELECT COALESCE(SUM(amount), 0) FROM deposits WHERE user_id = u.id AND status = 'completed') as total_deposited
            FROM users u 
            JOIN wallets w ON u.id = w.user_id 
            WHERE u.id = $1
        `, [req.user.userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Profile API Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// SMS Forwarder Webhook for Automatic Deposit Approval
app.post('/api/webhook/sms', async (req, res) => {
    // Expected format from SMS Forwarder: { from: "81122", body: "...", timestamp: "..." }
    const { from, body } = req.body;
    
    console.log(`[SMS Webhook] Received from ${from}: ${body}`);

    if (!from || !body) return res.sendStatus(400);

    // Only process Telebirr messages (often from '81122' or 'telebirr')
    if (from.toLowerCase().includes('81122') || from.toLowerCase().includes('telebirr')) {
        // Extract Transaction ID and Amount from Telebirr SMS
        // Example: "Transaction ID: ABC123DEF... amount: 50.00 ETB"
        const txMatch = body.match(/(?:Transaction ID|መለያ ቁጥር|ID)[:\s]+([A-Z0-9]+)/i) || body.match(/([A-Z0-9]{10,})/);
        const amountMatch = body.match(/(?:amount|መጠን)[:\s]*([\d,.]+)/i);

        if (txMatch) {
            const transactionId = txMatch[1];
            const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;

            console.log(`[SMS Webhook] Extracted TX: ${transactionId}, Amount: ${amount}`);

            // Find matching pending deposit
            try {
                const pendingMatch = await pool.query(
                    "SELECT * FROM deposits WHERE confirmation_code = $1 AND status = 'pending'",
                    [transactionId]
                );

                if (pendingMatch.rows.length > 0) {
                    const deposit = pendingMatch.rows[0];
                    
                    // Optional: verify amount if available in SMS
                    if (amount && Math.abs(parseFloat(deposit.amount) - amount) > 0.01) {
                        console.warn(`[SMS Webhook] Amount mismatch! SMS: ${amount}, DB: ${deposit.amount}`);
                        // We still continue or log for manual review, but matching TX ID is strong indicator
                    }

                    // Auto-approve
                    await pool.query("UPDATE deposits SET status = 'completed' WHERE id = $1", [deposit.id]);
                    await Wallet.deposit(deposit.user_id, deposit.amount, `Auto-Approved: ${transactionId}`);
                    
                    // Notify user via bot
                    const userResult = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [deposit.user_id]);
                    if (bot && userResult.rows[0]?.telegram_id) {
                        const userMsg = `✅ *የዲፖዚት ጥያቄዎ በራስ-ሰር ተረጋግጧል!*\n\nመጠን: ${deposit.amount} ETB\nትራንዛክሽን ID: ${transactionId}\n\nሒሳብዎ ላይ ተጨምሯል። መልካም ጨዋታ!`;
                        bot.sendMessage(userResult.rows[0].telegram_id, userMsg, { parse_mode: 'Markdown' }).catch(e => console.error('Bot notify error:', e));
                    }
                    
                    console.log(`[SMS Webhook] Auto-approved deposit for User ID: ${deposit.user_id}`);
                } else {
                    // Log for manual matching if needed later
                    console.log(`[SMS Webhook] No matching pending deposit for TX: ${transactionId}`);
                }
            } catch (err) {
                console.error('[SMS Webhook] Error processing match:', err);
            }
        }
    }

    res.sendStatus(200);
});

// Admin Endpoints
app.get('/api/admin/dashboard', adminAuthMiddleware, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            const userResult = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [req.user.userId]);
            const telegramId = userResult.rows[0]?.telegram_id;
            
            if (!telegramId || telegramId.toString() !== ADMIN_CHAT_ID.toString()) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
        const totalDeposits = await pool.query("SELECT SUM(amount) FROM deposits WHERE status = 'completed'");
        const totalCommission = await pool.query("SELECT SUM(prize_amount * 0.25) as commission FROM winners");
        const users = await pool.query(`
            SELECT u.id, u.username, u.telegram_id, (w.deposit_balance + w.win_balance) as balance 
            FROM users u 
            JOIN wallets w ON u.id = w.user_id 
            ORDER BY u.id DESC
        `);
        const deposits = await pool.query(`
            SELECT d.*, u.username 
            FROM deposits d 
            JOIN users u ON d.user_id = u.id 
            ORDER BY d.created_at DESC 
            LIMIT 50
        `);

        res.json({
            totalUsers: totalUsers.rows[0].count,
            totalDeposits: totalDeposits.rows[0].sum || 0,
            totalCommission: totalCommission.rows[0].commission || 0,
            users: users.rows,
            deposits: deposits.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/update-balance', adminAuthMiddleware, async (req, res) => {
    const { userId, amount, action } = req.body; // action: 'add', 'subtract', 'set'
    try {
        if (!req.user.isAdmin) {
            const userResult = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [req.user.userId]);
            const telegramId = userResult.rows[0]?.telegram_id;
            
            if (!telegramId || telegramId.toString() !== ADMIN_CHAT_ID.toString()) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        let result;
        if (action === 'add') {
            result = await Wallet.deposit(userId, amount, 'Admin adjustment: Add');
        } else if (action === 'subtract') {
            // Use Wallet.stake as a way to deduct
            result = await Wallet.stake(userId, amount, 0); // 0 as placeholder gameId
        } else if (action === 'set') {
            // Manually set
            await pool.query('UPDATE wallets SET deposit_balance = $1, win_balance = 0 WHERE user_id = $2', [amount, userId]);
            result = { success: true };
        } else {
            result = await Wallet.deposit(userId, amount, 'Admin adjustment');
        }
        
        if (result.success) {
            res.json({ success: true });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/approve-deposit', adminAuthMiddleware, async (req, res) => {
    const { depositId } = req.body;
    try {
        if (!req.user.isAdmin) {
            const userResult = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [req.user.userId]);
            const telegramId = userResult.rows[0]?.telegram_id;
            
            if (!telegramId || telegramId.toString() !== ADMIN_CHAT_ID.toString()) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const depositResult = await pool.query('SELECT d.*, u.telegram_id FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.id = $1', [depositId]);
        if (depositResult.rows.length === 0) return res.status(404).json({ error: 'Deposit not found' });
        const deposit = depositResult.rows[0];
        
        if (deposit.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

        await pool.query("UPDATE deposits SET status = 'completed' WHERE id = $1", [depositId]);
        await Wallet.deposit(deposit.user_id, deposit.amount, `Deposit Approved: ${deposit.confirmation_code}`);
        
        if (bot && deposit.telegram_id) {
            const userMsg = `✅ *የዲፖዚት ጥያቄዎ ተቀባይነት አግኝቷል!*\n\nመጠን: ${deposit.amount} ETB\nትራንዛክሽን ID: ${deposit.confirmation_code}\n\nሒሳብዎ ላይ ተጨምሯል። መልካም ጨዋታ!`;
            bot.sendMessage(deposit.telegram_id, userMsg, { parse_mode: 'Markdown' }).catch(err => console.error('Bot notify error:', err));
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/reject-deposit', adminAuthMiddleware, async (req, res) => {
    const { depositId, reason } = req.body;
    try {
        if (!req.user.isAdmin) {
            const userResult = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [req.user.userId]);
            const telegramId = userResult.rows[0]?.telegram_id;
            
            if (!telegramId || telegramId.toString() !== ADMIN_CHAT_ID.toString()) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const depositResult = await pool.query('SELECT d.*, u.telegram_id FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.id = $1', [depositId]);
        if (depositResult.rows.length === 0) return res.status(404).json({ error: 'Deposit not found' });
        const deposit = depositResult.rows[0];
        
        if (deposit.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

        await pool.query("UPDATE deposits SET status = 'rejected' WHERE id = $1", [depositId]);
        
        if (bot && deposit.telegram_id) {
            const userMsg = `❌ *የዲፖዚት ጥያቄዎ ውድቅ ተደርጓል*\n\nመጠን: ${deposit.amount} ETB\nትራንዛክሽን ID: ${deposit.confirmation_code}\n${reason ? `*ምክንያት:* ${reason}` : ''}\n\nእባክዎ መረጃውን አረጋግጠው ድጋሚ ይሞክሩ ወይም ለአድሚን ያሳውቁ።`;
            bot.sendMessage(deposit.telegram_id, userMsg, { parse_mode: 'Markdown' }).catch(err => console.error('Bot notify error:', err));
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/transactions', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20', [req.user.userId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/referral-stats', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // Get total referrals count
        const referralCount = await pool.query(
            'SELECT COUNT(*) FROM referrals WHERE referrer_id = $1',
            [userId]
        );
        
        // Get total earnings from referrals
        const referralEarnings = await pool.query(
            'SELECT COALESCE(SUM(bonus_amount), 0) as total FROM referrals WHERE referrer_id = $1',
            [userId]
        );
        
        // Get recent referrals with usernames
        const recentReferrals = await pool.query(
            `SELECT u.username, r.bonus_amount, r.created_at 
             FROM referrals r 
             JOIN users u ON r.referred_id = u.id 
             WHERE r.referrer_id = $1 
             ORDER BY r.created_at DESC LIMIT 10`,
            [userId]
        );
        
        res.json({
            totalReferrals: parseInt(referralCount.rows[0].count),
            totalEarnings: parseFloat(referralEarnings.rows[0].total),
            recentReferrals: recentReferrals.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// Standard error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

function getWinningLines(cardData, calledNumbers) {
    const lines = [];
    const isMarked = (r, c) => {
        const num = cardData[r][c];
        return num === 0 || calledNumbers.includes(num);
    };

    // Rows
    for (let r = 0; r < 5; r++) {
        let win = true;
        let cells = [];
        for (let c = 0; c < 5; c++) {
            if (!isMarked(r, c)) { win = false; break; }
            cells.push({ r, c });
        }
        if (win) lines.push({ type: 'row', index: r, cells });
    }

    // Columns
    for (let c = 0; c < 5; c++) {
        let win = true;
        let cells = [];
        for (let r = 0; r < 5; r++) {
            if (!isMarked(r, c)) { win = false; break; }
            cells.push({ r, c });
        }
        if (win) lines.push({ type: 'column', index: c, cells });
    }

    // Diagonals
    let d1 = true, d1Cells = [];
    for (let i = 0; i < 5; i++) {
        if (!isMarked(i, i)) { d1 = false; break; }
        d1Cells.push({ r: i, c: i });
    }
    if (d1) lines.push({ type: 'diagonal', index: 0, cells: d1Cells });

    let d2 = true, d2Cells = [];
    for (let i = 0; i < 5; i++) {
        if (!isMarked(i, 4 - i)) { d2 = false; break; }
        d2Cells.push({ r: i, c: 4 - i });
    }
    if (d2) lines.push({ type: 'diagonal', index: 1, cells: d2Cells });

    return lines;
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = {};
let lastGameData = {};
let gameStatus = 'selection'; // 'selection' or 'playing'
let selectionTimeLeft = 45;
let gameInterval = null;

function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function startGlobalTimer() {
    if (gameInterval) clearInterval(gameInterval);
    
    gameInterval = setInterval(() => {
        if (gameStatus === 'selection') {
            selectionTimeLeft--;
            broadcast({ type: 'timer', timeLeft: selectionTimeLeft, status: gameStatus });
            
            if (selectionTimeLeft <= 0) {
                // Check if anyone has selected a card
                const playerArray = Object.values(players);
                const anySelection = playerArray.some(p => p.selectedCardId);
                
                if (anySelection) {
                    gameStatus = 'playing';
                    selectionTimeLeft = 0;
                    
                    const totalPlayers = Object.values(players).filter(p => p.selectedCardId).length;
                    const totalStake = totalPlayers * 10;
                    const prize = Math.floor(totalStake * 0.8);

                    broadcast({ 
                        type: 'game_start', 
                        status: gameStatus,
                        playerCount: totalPlayers,
                        prizePool: prize
                    });
                    
                    // Generate numbers and manage game state
                    const gameId = 'game_' + Date.now();
                    const calledNumbers = [];
                    const numbersPool = Array.from({length: 75}, (_, i) => i + 1);
                    
                    // Shuffle numbers pool
                    for (let i = numbersPool.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [numbersPool[i], numbersPool[j]] = [numbersPool[j], numbersPool[i]];
                    }

                    gameInterval = setInterval(() => {
                        if (gameStatus !== 'playing') {
                            clearInterval(gameInterval);
                            startGlobalTimer(); 
                            return;
                        }

                        if (numbersPool.length > 0) {
                            const num = numbersPool.pop();
                            calledNumbers.push(num);
                            
                            playerArray.forEach(p => {
                                if (p.selectedCardId) {
                                    if (!lastGameData[p.userId]) lastGameData[p.userId] = {};
                                    lastGameData[p.userId].calledNumbers = [...calledNumbers];
                                }
                            });

                            broadcast({ type: 'number_called', number: num, allCalled: calledNumbers });
                        } else {
                            clearInterval(gameInterval);
                            gameStatus = 'selection';
                            selectionTimeLeft = 45;
                            broadcast({ type: 'game_end', status: gameStatus });
                            startGlobalTimer();
                        }
                    }, 2000); 
                } else {
                    // No selections, recycle timer
                    selectionTimeLeft = 45;
                    broadcast({ type: 'timer', timeLeft: selectionTimeLeft, status: gameStatus });
                }
            }
        }
    }, 1000);
}

startGlobalTimer();

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        if (data.type === 'init') {
            ws.userId = data.userId;
            ws.username = data.username || `Player_${data.userId.toString().slice(-4)}`;
            players[data.userId] = ws;
            console.log(`[USER INIT] ${ws.username} connected (ID: ${ws.userId})`);
            ws.send(JSON.stringify({ type: 'timer', timeLeft: selectionTimeLeft, status: gameStatus }));
            
            // Send current selection state to the new connection
            const takenCards = Object.values(players)
                .filter(p => p.selectedCardId)
                .map(p => p.selectedCardId);
            const totalPlayers = takenCards.length;
            const prize = Math.floor(totalPlayers * 10 * 0.8);

            ws.send(JSON.stringify({ 
                type: 'selection_update', 
                takenCards: takenCards,
                playerCount: totalPlayers,
                prizePool: prize
            }));
        } else if (data.type === 'select_card') {
            const stake = 10;
            // Check if card is already taken
            const isTaken = Object.values(players).some(p => p.selectedCardId === data.cardId);
            if (isTaken) {
                ws.send(JSON.stringify({ type: 'error', message: 'ይህ ካርድ ተይዟል! እባክዎ ሌላ ይምረጡ።' }));
                return;
            }

            Wallet.stake(ws.userId, stake, 0)
                .then(result => {
                    if (!result.success) {
                        ws.send(JSON.stringify({ type: 'error', message: result.error || 'በቂ የሂሳብ መጠን የለዎትም!' }));
                        return;
                    }
                    
                    ws.selectedCardId = data.cardId;
                    ws.stakeAmount = stake;
                    console.log(`[CARD SELECTION] ${ws.username} selected card #${data.cardId}`);
                    
                    // Broadcast updated selections to everyone immediately
                    const takenCards = Object.values(players)
                        .filter(p => p.selectedCardId)
                        .map(p => p.selectedCardId);
                    
                    const totalPlayers = Object.values(players).filter(p => p.selectedCardId).length;
                    const totalStake = totalPlayers * stake;
                    const prize = Math.floor(totalStake * 0.8);

                    broadcast({ 
                        type: 'selection_update', 
                        takenCards: takenCards,
                        playerCount: totalPlayers,
                        prizePool: prize,
                        lastSelected: {
                            userId: ws.userId,
                            username: ws.username,
                            cardId: data.cardId
                        }
                    });

                    ws.send(JSON.stringify({ type: 'card_confirmed', cardId: data.cardId, newBalance: result.balance }));
                })
                .catch(err => {
                    console.error('[STAKE ERROR]', err);
                    ws.send(JSON.stringify({ type: 'error', message: 'የውርርድ ክፍያ አልተሳካም!' }));
                });
        } else if (data.type === 'call_bingo') {
            if (!ws.selectedCardId) {
                console.log(`[BINGO FAILED] ${ws.username} has no card selected`);
                ws.send(JSON.stringify({ type: 'bingo_rejected', reason: 'ምንም ካርድ አልመረጡም!' }));
                return;
            }

            console.log(`[BINGO ATTEMPT] User: ${ws.username}, Card: #${ws.selectedCardId}`);

            if (ws.bingoCheckTimeout) clearTimeout(ws.bingoCheckTimeout);

            broadcast({ 
                type: 'bingo_checking', 
                username: ws.username
            });

            ws.bingoCheckTimeout = setTimeout(() => {
                const calledNumbers = lastGameData[ws.userId]?.calledNumbers || [];
                const isValid = validateBingo(ws.selectedCardId, calledNumbers);
                
                console.log(`[BINGO VALIDATION] User: ${ws.username}, Card: #${ws.selectedCardId}, Result: ${isValid}, Called: ${calledNumbers.join(',')}`);
                
                if (isValid) {
                    if (gameInterval) clearInterval(gameInterval);
                    
                    const cardData = require('./data/cards').BINGO_CARDS[ws.selectedCardId];
                    const winLines = getWinningLines(cardData, calledNumbers);
                    
                    // Award prize and update wallet
                    const totalPlayers = Object.values(players).filter(p => p.selectedCardId).length;
                    const totalStake = totalPlayers * 10;
                    const prize = Math.floor(totalStake * 0.8);
                    
                    Wallet.win(ws.userId, prize, 0) // Using 0 as placeholder gameId
                        .then(() => {
                            pool.query('INSERT INTO winners (user_id, card_id, prize_amount) VALUES ($1, $2, $3)', 
                                [ws.userId, ws.selectedCardId, prize]);
                        })
                        .catch(err => console.error('[WIN ERROR] Failed to update balance:', err));

                    const winnerData = { 
                        type: 'winner', 
                        userId: ws.userId, 
                        username: ws.username, 
                        cardId: ws.selectedCardId,
                        winLines: winLines,
                        prize: prize 
                    };
                    
                    console.log(`[WINNER DECLARED] ${ws.username} won! Broadcasting to ${wss.clients.size} clients.`);
                    
                    // Broadcast winner data
                    broadcast(winnerData);
                    
                    // Wait 4 seconds after winner declaration, then reset all players and start selection
                    setTimeout(() => {
                        console.log(`[GAME RESET] Cleaning up after winner and starting new selection period.`);
                        
                        // Clear all player selection data
                        for (let id in players) {
                            players[id].selectedCardId = null;
                        }
                        
                        // Clear game state data
                        lastGameData = {};
                        
                        // Transition to selection mode
                        gameStatus = 'selection';
                        selectionTimeLeft = 45;
                        
                        broadcast({ 
                            type: 'game_reset', 
                            status: gameStatus,
                            timeLeft: selectionTimeLeft
                        });
                        
                        // Restart the global timer loop
                        startGlobalTimer();
                    }, 4000);
                } else {
                    console.log(`[BINGO REJECTED] ${ws.username} card #${ws.selectedCardId} - Pattern NOT found in called numbers.`);
                    ws.send(JSON.stringify({ 
                        type: 'bingo_rejected', 
                        reason: 'የተመረጠው ካርድ ገና አልዘጋም! እባክዎ ቁጥሮቹን በደንብ ይፈትሹ።' 
                    }));
                    broadcast({ type: 'bingo_check_failed' });
                }
                delete ws.bingoCheckTimeout;
            }, 3000);
        }
    });

    function getWinningLines(cardData, markedNumbers) {
        const lines = [];
        const isMarked = (r, c) => {
            const num = cardData[r][c];
            return num === 0 || markedNumbers.includes(num);
        };

        // Rows
        for (let r = 0; r < 5; r++) {
            let win = true;
            let cells = [];
            for (let c = 0; c < 5; c++) {
                if (!isMarked(r, c)) { win = false; break; }
                cells.push({r, c});
            }
            if (win) lines.push({type: 'row', cells});
        }
        // Cols
        for (let c = 0; c < 5; c++) {
            let win = true;
            let cells = [];
            for (let r = 0; r < 5; r++) {
                if (!isMarked(r, c)) { win = false; break; }
                cells.push({r, c});
            }
            if (win) lines.push({type: 'col', cells});
        }
        // Diagonals
        let d1Win = true, d1Cells = [];
        let d2Win = true, d2Cells = [];
        for (let i = 0; i < 5; i++) {
            if (!isMarked(i, i)) d1Win = false;
            else d1Cells.push({r: i, c: i});
            
            if (!isMarked(i, 4 - i)) d2Win = false;
            else d2Cells.push({r: i, c: 4 - i});
        }
        if (d1Win) lines.push({type: 'diag', cells: d1Cells});
        if (d2Win) lines.push({type: 'diag', cells: d2Cells});

        return lines;
    }
    
    function validateBingo(cardId, markedNumbers) {
        const cardData = require('./data/cards').BINGO_CARDS[cardId];
        if (!cardData) return false;

        const isMarked = (r, c) => {
            const num = cardData[r][c];
            return num === 0 || markedNumbers.includes(num);
        };

        // Rows
        for (let r = 0; r < 5; r++) {
            let win = true;
            for (let c = 0; c < 5; c++) if (!isMarked(r, c)) { win = false; break; }
            if (win) return true;
        }

        // Columns
        for (let c = 0; c < 5; c++) {
            let win = true;
            for (let r = 0; r < 5; r++) if (!isMarked(r, c)) { win = false; break; }
            if (win) return true;
        }

        // Diagonals
        let diag1 = true;
        for (let i = 0; i < 5; i++) if (!isMarked(i, i)) diag1 = false;
        if (diag1) return true;

        let diag2 = true;
        for (let i = 0; i < 5; i++) if (!isMarked(i, 4 - i)) diag2 = false;
        if (diag2) return true;

        // 4 Corners
        if (isMarked(0, 0) && isMarked(0, 4) && isMarked(4, 0) && isMarked(4, 4)) return true;

        // Diamond (X)
        if (isMarked(1, 2) && isMarked(3, 2) && isMarked(2, 1) && isMarked(2, 3)) return true;

        return false;
    }

    ws.on('close', () => {
        // Clean up disconnected players
        let updated = false;
        for (let id in players) {
            if (players[id] === ws) {
                if (players[id].selectedCardId) updated = true;
                delete players[id];
                break;
            }
        }

        if (updated) {
            const takenCards = Object.values(players)
                .filter(p => p.selectedCardId)
                .map(p => p.selectedCardId);
            const totalPlayers = takenCards.length;
            const prize = Math.floor(totalPlayers * 10 * 0.8);

            broadcast({ 
                type: 'selection_update', 
                takenCards: takenCards,
                playerCount: totalPlayers,
                prizePool: prize
            });
        }
    });
});

const PORT = process.env.PORT || 5000;
db.initializeDatabase().then(() => {
    server.listen(PORT, '0.0.0.0', () => console.log(`Server on ${PORT}`));
});
