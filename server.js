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
                    ],
                    [
                        { text: "🌐 Website", url: currentDomain },
                        { text: "❓ Help", callback_data: 'help_patterns' }
                    ],
                    [
                        { text: "☎️ Support", url: "https://t.me/royalsup1" }
                    ]
                ]
            }
        };

        bot.sendMessage(chatId, welcomeMessage, opts).catch(err => console.error('[BOT] Start message failed:', err));
    });

    // Handle Callback Queries
    bot.on('callback_query', (query) => {
        const chatId = query.message.chat.id;
        const data = query.data;

        if (data === 'help_patterns') {
            const helpText = `📖 *የማሸነፊያ መንገዶች (Winning Patterns)*\n\n` +
                `1. *Horizontal*: በአንድ ረድፍ ላይ ያሉ 5 ቁጥሮች ሲሞሉ\n` +
                `2. *Vertical*: በአንድ አምድ ላይ ያሉ 5 ቁጥሮች ሲሞሉ\n` +
                `3. *Diagonal*: ከዳር እስከ ዳር ባለው መስመር 5 ቁጥሮች ሲሞሉ\n` +
                `4. *Four Corners*: አራቱ የካርዱ ማዕዘኖች ሲሞሉ\n` +
                `5. *Cross*: ከ "FREE" አጠገብ ያሉ አራት ቁጥሮች በመስቀለኛ ቅርጽ ሲሞሉ\n\n` +
                `እነዚህ ሲሞሉ BINGO የሚለውን ቁልፍ በመጫን ያሸንፉ!`;
            
            bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
            bot.answerCallbackQuery(query.id);
        }
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

// Middleware to check maintenance mode
const maintenanceMiddleware = async (req, res, next) => {
    try {
        const maintenance = await pool.query("SELECT value FROM settings WHERE key = 'maintenance_mode'");
        if (maintenance.rows.length > 0 && maintenance.rows[0].value === 'true') {
            // Only block specific gameplay endpoints
            const blockedEndpoints = ['/api/game/join', '/api/game/select-card'];
            if (blockedEndpoints.includes(req.path)) {
                return res.status(503).json({ 
                    error: 'ጥገና ላይ ነን! (Maintenance Mode)', 
                    message: 'ለጥቂት ሰዓታት ጥገና እያደረግን ስለሆነ ለጊዜው ካርድ መምረጥ አይቻልም። በቅርቡ እንመለሳለን!' 
                });
            }
        }
        next();
    } catch (err) {
        next();
    }
};

// --- Web API ---
app.use('/api/game', maintenanceMiddleware);
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

        // Check if this transaction ID was already used
        const existingDeposit = await pool.query("SELECT id FROM deposits WHERE confirmation_code = $1", [transactionId]);
        if (existingDeposit.rows.length > 0) {
            return res.status(400).json({ error: 'ይህ የትራንዛክሽን መለያ ቁጥር ቀድሞ ጥቅም ላይ ውሏል!' });
        }

        // Check if we already received an SMS for this transaction
        const matchedSms = await pool.query(
            "SELECT * FROM received_sms WHERE transaction_id = $1 AND processed = false",
            [transactionId]
        );

        let status = 'pending';
        if (matchedSms.rows.length > 0) {
            status = 'completed';
        }

        const result = await pool.query(
            'INSERT INTO deposits (user_id, amount, confirmation_code, payment_method, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [req.user.userId, amount, transactionId, method, status]
        );
        
        if (status === 'completed') {
            await Wallet.deposit(req.user.userId, amount, `Auto-Approved (SMS first): ${transactionId}`);
            await pool.query("UPDATE received_sms SET processed = true WHERE transaction_id = $1", [transactionId]);
            
            if (bot) {
                const userMsg = `✅ *የዲፖዚት ጥያቄዎ ወዲያውኑ ተረጋግጧል!*\n\nመጠን: ${amount} ETB\nትራንዛክሽን ID: ${transactionId}\n\nመልካም ጨዋታ!`;
                bot.sendMessage(req.user.telegram_id || (await pool.query('SELECT telegram_id FROM users WHERE id = $1', [req.user.userId])).rows[0].telegram_id, userMsg, { parse_mode: 'Markdown' }).catch(e => console.error('Bot notify error:', e));
            }
        } else if (bot) {
            const adminMsg = `💰 *አዲስ የዲፖዚት ጥያቄ*\n\nተጠቃሚ: ${req.user.username}\nመጠን: ${amount} ETB\nትራንዛክሽን ID: ${transactionId}\nመንገድ: ${method}\n\n*ሙሉ ቴክስት:*\n\`${smsText || 'ያልተገለጸ'}\``;
            bot.sendMessage(ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' }).catch(err => console.error('Admin notify error:', err));
        }
        
        res.json({ success: true, depositId: result.rows[0].id, autoApproved: status === 'completed' });
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

        const result = await Wallet.withdraw(
            req.user.userId, 
            amount, 
            `Withdrawal to ${method}: ${accountDetails}`,
            accountDetails,
            method
        );
        
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        if (bot) {
            const adminMsg = `💸 *አዲስ የዊዝድሮው ጥያቄ*\n\nተጠቃሚ: ${req.user.username}\nመጠን: ${amount} ETB\nመንገድ: ${method}\nዝርዝር: ${accountDetails}\n\n⏳ *ለማጽደቅ አድሚን ፓናል ይጎብኙ*`;
            bot.sendMessage(ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' }).catch(err => console.error('Admin notify error:', err));
        }

        res.json({ success: true, message: 'የዊዝድሮው ጥያቄዎ ተልኳል። በቅርቡ ይጸድቃል!' });
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
            await pool.query('INSERT INTO wallets (user_id, deposit_balance) VALUES ($1, 10.00)', [user.id]);
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
            const welcomeMessage = `እንኳን ደስ አሎት! 🎉\n\nምዝገባዎ በተሳካ ሁኔታ ተጠናቋል፡፡ የ 10 ብር የመመዝገቢያ ቦነስ ወደ አካውንትዎ ገብቷል፡፡ አሁን ተወዳጁን ሮያል ቢንጎን መጫወት ይችላሉ፡፡\n\nመልካም እድል! 👑`;
            
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
        await pool.query('INSERT INTO wallets (user_id, deposit_balance) VALUES ($1, 10.00)', [userId]);
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
        botUsername: 'RoyalBingoVV2_bot'
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

app.get('/api/leaderboard', async (req, res) => {
    try {
        const period = req.query.period || 'daily';
        
        // Ethiopia is UTC+3. 
        // 6:00 AM Ethiopia time (ቅዳሴ/ስድስት ሰዓት) is 3:00 AM UTC.
        // However, the user said "ለሊት ስድሰአት" which usually means 12:00 AM (Midnight) in local 12h format 
        // or specifically 6:00 local hours past sunset.
        // In Ethiopia, "ስድስት ሰዓት" (6:00) at night is Midnight (00:00).
        // To handle this in SQL, we offset the current time by 3 hours for UTC+3.
        
        let dateFilter = '';
        if (period === 'daily') {
            // Reset at Midnight Ethiopia time (UTC+3)
            // We subtract 3 hours from UTC to align with Ethiopian start of day
            dateFilter = "AND w.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Addis_Ababa' >= CURRENT_DATE AT TIME ZONE 'Africa/Addis_Ababa'";
        } else if (period === 'weekly') {
            // Reset every Sunday Midnight Ethiopia time
            // In Postgres, date_trunc('week', ...) defaults to Monday. 
            // To reset on Sunday Midnight (start of Monday), we can use the default week trunc 
            // as it effectively starts the new week on Monday 00:00.
            dateFilter = "AND w.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Addis_Ababa' >= date_trunc('week', now() AT TIME ZONE 'Africa/Addis_Ababa')";
        } else if (period === 'monthly') {
            // Reset 1st of month Midnight Ethiopia time
            dateFilter = "AND w.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Addis_Ababa' >= date_trunc('month', now() AT TIME ZONE 'Africa/Addis_Ababa')";
        }
        
        const leaderboard = await pool.query(`
            SELECT 
                u.id,
                u.username,
                COUNT(w.id) as total_wins,
                COALESCE(SUM(w.prize_amount), 0) as total_earnings
            FROM users u
            JOIN winners w ON u.id = w.user_id
            WHERE 1=1 ${dateFilter}
            GROUP BY u.id, u.username
            HAVING COUNT(w.id) > 0
            ORDER BY total_earnings DESC, total_wins DESC
            LIMIT 50
        `);

        res.json({
            period: period,
            leaderboard: leaderboard.rows
        });
    } catch (err) {
        console.error('Leaderboard API Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// SMS Forwarder Webhook for Automatic Deposit Approval
app.post('/api/webhook/sms', async (req, res) => {
    try {
        const { from, body } = req.body;
        console.log(`[SMS Webhook] Received from ${from}: ${body}`);

        if (!from || !body) {
            console.log('[SMS Webhook] Missing from or body');
            return res.sendStatus(400);
        }

        if (from.toLowerCase().includes('81122') || from.toLowerCase().includes('telebirr') || from.includes('TELEBIRR') || from.toLowerCase().includes('forwarder')) {
            // More robust regex for Transaction ID
            const txMatch = body.match(/(?:Transaction ID|መለያ ቁጥር|ID|Ref)[:\s]*([A-Z0-9]{8,})/i) || body.match(/([A-Z0-9]{10,})/);
            // More robust regex for Amount
            const amountMatch = body.match(/(?:amount|መጠን|ብር|ETB)[:\s]*([\d,.]+)/i) || body.match(/([\d,.]+)\s*(?:ብር|ETB)/i);

            if (txMatch) {
                const transactionId = txMatch[1].trim();
                const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;

                console.log(`[SMS Webhook] Successfully parsed: TX=${transactionId}, Amount=${amount}`);

                // Check if this SMS was already received/processed
                const existingSms = await pool.query("SELECT id FROM received_sms WHERE transaction_id = $1", [transactionId]);
                if (existingSms.rows.length > 0) {
                    console.log(`[SMS Webhook] SMS for TX ${transactionId} already exists. Skipping.`);
                    return res.sendStatus(200);
                }

                // Save to received_sms table
                await pool.query(
                    "INSERT INTO received_sms (transaction_id, amount, body, sender) VALUES ($1, $2, $3, $4)",
                    [transactionId, amount, body, from]
                );

                // Check if there's a matching pending deposit from a user
                const pendingMatch = await pool.query(
                    "SELECT * FROM deposits WHERE confirmation_code = $1 AND status = 'pending'",
                    [transactionId]
                );

                if (pendingMatch.rows.length > 0) {
                    const deposit = pendingMatch.rows[0];
                    const depAmount = parseFloat(deposit.amount);
                    const bonus = depAmount * 0.10;
                    
                    console.log(`[SMS Webhook] Matching pending deposit found for user ${deposit.user_id}`);
                    
                    await pool.query("UPDATE deposits SET status = 'completed' WHERE id = $1", [deposit.id]);
                    
                    // Base amount to total balance
                    await Wallet.deposit(deposit.user_id, depAmount, `Auto-Approved: ${transactionId}`);
                    
                    // 10% bonus to deposit_balance (non-withdrawable)
                    if (bonus > 0) {
                        await pool.query('UPDATE wallets SET deposit_balance = deposit_balance + $1 WHERE user_id = $2', [bonus, deposit.user_id]);
                        await pool.query(
                            'INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                            [deposit.user_id, bonus, 'deposit_bonus', `10% Deposit bonus for TX ${transactionId}`]
                        );
                    }
                    
                    await pool.query("UPDATE received_sms SET processed = true WHERE transaction_id = $1", [transactionId]);
                    
                    const userResult = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [deposit.user_id]);
                    if (bot && userResult.rows[0]?.telegram_id) {
                        const userMsg = `✅ *የዲፖዚት ጥያቄዎ በራስ-ሰር ተረጋግጧል!*\n\nመጠን: ${depAmount} ETB\nቦነስ (10%): ${bonus.toFixed(2)} ETB\nትራንዛክሽን ID: ${transactionId}\n\nመልካም ጨዋታ!`;
                        bot.sendMessage(userResult.rows[0].telegram_id, userMsg, { parse_mode: 'Markdown' }).catch(e => console.error('Bot notify error:', e));
                    }
                } else {
                    console.log(`[SMS Webhook] No pending deposit found for TX ${transactionId} yet.`);
                }
            } else {
                console.log('[SMS Webhook] Could not parse Transaction ID from body');
            }
        } else {
            console.log(`[SMS Webhook] Sender ${from} not recognized as telebirr`);
        }
        res.sendStatus(200);
    } catch (err) {
        console.error('[SMS Webhook] Critical Error:', err);
        res.status(500).send(err.message);
    }
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
        
        const withdrawals = await pool.query(`
            SELECT w.*, u.username, u.telegram_id
            FROM withdrawals w 
            JOIN users u ON w.user_id = u.id 
            ORDER BY w.created_at DESC 
            LIMIT 50
        `);

        res.json({
            totalUsers: totalUsers.rows[0].count,
            totalDeposits: totalDeposits.rows[0].sum || 0,
            totalCommission: totalCommission.rows[0].commission || 0,
            users: users.rows,
            deposits: deposits.rows,
            withdrawals: withdrawals.rows
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

app.post('/api/admin/approve-withdrawal', adminAuthMiddleware, async (req, res) => {
    const { withdrawalId } = req.body;
    try {
        if (!req.user.isAdmin) {
            const userResult = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [req.user.userId]);
            const telegramId = userResult.rows[0]?.telegram_id;
            
            if (!telegramId || telegramId.toString() !== ADMIN_CHAT_ID.toString()) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const withdrawalResult = await pool.query(`
            SELECT w.*, u.telegram_id, u.username 
            FROM withdrawals w 
            JOIN users u ON w.user_id = u.id 
            WHERE w.id = $1
        `, [withdrawalId]);
        
        if (withdrawalResult.rows.length === 0) return res.status(404).json({ error: 'Withdrawal not found' });
        const withdrawal = withdrawalResult.rows[0];
        
        if (withdrawal.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

        await pool.query("UPDATE withdrawals SET status = 'completed', processed_at = NOW() WHERE id = $1", [withdrawalId]);
        
        await pool.query(
            `UPDATE transactions SET type = 'withdrawal' WHERE user_id = $1 AND type = 'withdrawal_pending' AND amount = $2`,
            [withdrawal.user_id, withdrawal.amount]
        );
        
        if (bot && withdrawal.telegram_id) {
            const userMsg = `✅ *የዊዝድሮው ጥያቄዎ ተጠናቅቋል!*\n\nመጠን: ${withdrawal.amount} ETB\nወደ: ${withdrawal.phone_number}\nዝርዝር: ${withdrawal.account_name}\n\nገንዘብዎ ተልኳል። አመሰግናለሁ!`;
            bot.sendMessage(withdrawal.telegram_id, userMsg, { parse_mode: 'Markdown' }).catch(err => console.error('Bot notify error:', err));
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/reject-withdrawal', adminAuthMiddleware, async (req, res) => {
    const { withdrawalId, reason } = req.body;
    try {
        if (!req.user.isAdmin) {
            const userResult = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [req.user.userId]);
            const telegramId = userResult.rows[0]?.telegram_id;
            
            if (!telegramId || telegramId.toString() !== ADMIN_CHAT_ID.toString()) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const withdrawalResult = await pool.query(`
            SELECT w.*, u.telegram_id, u.username 
            FROM withdrawals w 
            JOIN users u ON w.user_id = u.id 
            WHERE w.id = $1
        `, [withdrawalId]);
        
        if (withdrawalResult.rows.length === 0) return res.status(404).json({ error: 'Withdrawal not found' });
        const withdrawal = withdrawalResult.rows[0];
        
        if (withdrawal.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

        await pool.query("UPDATE withdrawals SET status = 'rejected', processed_at = NOW() WHERE id = $1", [withdrawalId]);
        
        await pool.query(
            `UPDATE wallets SET win_balance = win_balance + $1 WHERE user_id = $2`,
            [withdrawal.amount, withdrawal.user_id]
        );
        
        await pool.query(
            `DELETE FROM transactions WHERE user_id = $1 AND type = 'withdrawal_pending' AND amount = $2`,
            [withdrawal.user_id, withdrawal.amount]
        );
        
        if (bot && withdrawal.telegram_id) {
            const userMsg = `❌ *የዊዝድሮው ጥያቄዎ ውድቅ ተደርጓል*\n\nመጠን: ${withdrawal.amount} ETB\n${reason ? `*ምክንያት:* ${reason}` : ''}\n\nገንዘብዎ ወደ ሂሳብዎ ተመልሷል።`;
            bot.sendMessage(withdrawal.telegram_id, userMsg, { parse_mode: 'Markdown' }).catch(err => console.error('Bot notify error:', err));
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/broadcast', adminAuthMiddleware, upload.single('image'), async (req, res) => {
    const { message } = req.body;
    const imagePath = req.file ? req.file.path : null;
    
    try {
        if (!req.user.isAdmin) {
            const userResult = await pool.query('SELECT telegram_id FROM users WHERE id = $1', [req.user.userId]);
            const telegramId = userResult.rows[0]?.telegram_id;
            if (!telegramId || telegramId.toString() !== ADMIN_CHAT_ID.toString()) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const users = await pool.query('SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL');
        let successCount = 0;
        let failCount = 0;

        for (const user of users.rows) {
            try {
                if (imagePath) {
                    await bot.sendPhoto(user.telegram_id, fs.createReadStream(imagePath), {
                        caption: message,
                        parse_mode: 'Markdown'
                    });
                } else {
                    await bot.sendMessage(user.telegram_id, message, { parse_mode: 'Markdown' });
                }
                successCount++;
            } catch (err) {
                console.error(`Failed to send broadcast to ${user.telegram_id}:`, err.message);
                failCount++;
            }
        }

        if (imagePath) fs.unlinkSync(imagePath); // Clean up uploaded file

        res.json({ success: true, successCount, failCount });
    } catch (err) {
        console.error('Broadcast Error:', err);
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
    // 1. መጀመሪያ ማንኛውም ንቁ የሆነ ቆጣሪ ካለ እናጠፋዋለን (ሰዓቱ እንዳይደራረብ ዋናው መፍትሄ ይህ ነው)
    if (gameInterval) clearInterval(gameInterval);
    
    gameInterval = setInterval(() => {
        if (gameStatus === 'selection') {
            selectionTimeLeft--;
            broadcast({ type: 'timer', timeLeft: selectionTimeLeft, status: gameStatus });
            
            if (selectionTimeLeft <= 0) {
                const playerArray = Object.values(players);
                const playersWithCards = playerArray.filter(p => p.selectedCardId);
                const totalPlayers = playersWithCards.length;
                
                if (totalPlayers >= 2) {
                    // 2+ players - start the game
                    gameStatus = 'playing';
                    selectionTimeLeft = 0;
                    
                    clearInterval(gameInterval); 
                    
                    const totalStake = totalPlayers * 10;
                    const prize = Math.floor(totalStake * 0.8);

                    broadcast({ 
                        type: 'game_start', 
                        status: gameStatus,
                        playerCount: totalPlayers,
                        prizePool: prize
                    });
                    
                    const calledNumbers = [];
                    const numbersPool = Array.from({length: 75}, (_, i) => i + 1);
                    
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
                    }, 3000);
                } else if (totalPlayers === 1) {
                    // Only 1 player - refund their stake and reset
                    const singlePlayer = playersWithCards[0];
                    console.log(`[GAME] Only 1 player (${singlePlayer.username}), refunding stake...`);
                    
                    Wallet.refundStake(singlePlayer.userId, 10)
                        .then(() => {
                            console.log(`[REFUND] Stake refunded to ${singlePlayer.username}`);
                            if (singlePlayer.ws && singlePlayer.ws.readyState === 1) {
                                singlePlayer.ws.send(JSON.stringify({ 
                                    type: 'stake_refunded', 
                                    message: 'ቢያንስ 2 ተጫዋቾች ስላልነበሩ ገንዘብዎ ተመልሷል።',
                                    amount: 10
                                }));
                            }
                        })
                        .catch(err => console.error('[REFUND ERROR]', err));
                    
                    singlePlayer.selectedCardId = null;
                    singlePlayer.stakeAmount = 0;
                    if (singlePlayer.ws) {
                        singlePlayer.ws.selectedCardId = null;
                        singlePlayer.ws.stakeAmount = 0;
                    }
                    
                    selectionTimeLeft = 45;
                    broadcast({ 
                        type: 'game_cancelled', 
                        message: 'ቢያንስ 2 ተጫዋቾች ያስፈልጋሉ። እባክዎ እንደገና ይሞክሩ።',
                        takenCards: []
                    });
                    broadcast({ type: 'timer', timeLeft: selectionTimeLeft, status: gameStatus });
                } else {
                    // No players - reset timer
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
            if (gameStatus === 'playing') {
                ws.send(JSON.stringify({ type: 'error', message: 'ጨዋታ እየተካሄደ ነው! እባክዎ ጨዋታው እስኪያልቅ ይጠብቁ።' }));
                return;
            }
            
            const stake = 10;
            // Check if card is already taken by another player
            const isTaken = Object.values(players).some(p => p.selectedCardId === data.cardId && p.userId !== ws.userId);
            if (isTaken) {
                ws.send(JSON.stringify({ type: 'error', message: 'ይህ ካርድ ተይዟል! እባክዎ ሌላ ይምረጡ።' }));
                return;
            }
            
            // Check if player already paid for this round (changing card without extra charge)
            const alreadyPaid = ws.stakeAmount > 0;
            
            if (alreadyPaid) {
                // Player already paid - just update their card selection, no charge
                const oldCardId = ws.selectedCardId;
                ws.selectedCardId = data.cardId;
                console.log(`[CARD CHANGE] ${ws.username} changed card from #${oldCardId} to #${data.cardId} (no extra charge)`);
                
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

                ws.send(JSON.stringify({ type: 'card_confirmed', cardId: data.cardId, message: 'ካርድ ተቀይሯል (ተጨማሪ ክፍያ የለም)' }));
            } else {
                // First card selection - charge stake
                Wallet.stake(ws.userId, stake, 0)
                    .then(result => {
                        if (!result.success) {
                            ws.send(JSON.stringify({ type: 'error', message: result.error || 'በቂ የሂሳብ መጠን የለዎትም!' }));
                            return;
                        }
                        
                        ws.selectedCardId = data.cardId;
                        ws.stakeAmount = stake;
                        console.log(`[CARD SELECTION] ${ws.username} selected card #${data.cardId}`);
                        
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
            }
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
