# Royal Bingo

## Overview
Royal Bingo is a Telegram-based bingo game application with web frontend. Users can play bingo games with stake-based wagering, manage wallets, and interact via Telegram bot.

## Project Structure
```
/
├── server.js           # Main Express server with WebSocket support
├── package.json        # Node.js dependencies
├── db/
│   └── database.js     # PostgreSQL database connection and schema
├── models/
│   ├── User.js         # User model
│   ├── Wallet.js       # Wallet model  
│   └── Game.js         # Game model
├── data/
│   └── cards.js        # Bingo cards data and validation
├── public/
│   ├── index.html      # Main frontend
│   ├── admin.html      # Admin panel
│   ├── style.css       # Styles
│   ├── card.js         # Frontend card logic
│   └── game.js         # Frontend game logic
└── uploads/            # User uploads directory
```

## Technologies
- **Backend**: Node.js with Express
- **Database**: PostgreSQL (via pg package)
- **Real-time**: WebSocket (ws package)
- **Cache**: Redis (optional, for real-time game state)
- **Bot**: Telegram Bot API (node-telegram-bot-api)
- **Auth**: JWT tokens, bcrypt for password hashing

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (required, auto-configured on Replit/Render)
- `TELEGRAM_BOT_TOKEN` - Telegram bot token (optional, for bot functionality)
- `ADMIN_CHAT_ID` - Telegram chat ID for admin user (required for admin access)
- `JWT_SECRET` - Secret for JWT tokens (required, auto-generated on Render)
- `REDIS_URL` - Redis connection URL (optional, falls back to in-memory)
- `RENDER_EXTERNAL_URL` - Auto-provided by Render for production URL
- `MINI_APP_URL` - Custom URL override (optional)
- `REPLIT_DEV_DOMAIN` - Auto-provided by Replit for development URL

## Deployment Compatibility
This app is designed to work on both Render and Replit:
- Server binds to `0.0.0.0:5000` for both platforms
- URL detection: RENDER_EXTERNAL_URL > MINI_APP_URL > REPLIT_DEV_DOMAIN > fallback
- WebSocket support enabled for real-time gameplay

## Running the Application
The server runs on port 5000 and serves static files from the `/public` directory.

## Recent Changes
- 2026-01-25: Fixed withdrawal logic - now checks total deposited amount (>= 100 ETB) instead of single deposit.
- 2026-01-25: Fixed withdrawal win check - now uses winners table instead of game_participants.
- 2026-01-25: Added pending withdrawal request system - admin must approve before funds are released.
- 2026-01-25: Added withdrawal management section to admin panel.
- 2026-01-25: Added 10% deposit bonus (non-withdrawable) for all deposits.
- 2026-01-25: Updated landing page layout and reduced signup bonus to 10 ETB.
- 2026-01-25: Updated bot link to @RoyalBingoVV2_bot and added news channel link.
