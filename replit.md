# Royal Bingo

## Overview
Royal Bingo is a Telegram-integrated bingo game application built with Node.js and Express. The app allows users to play bingo games, manage wallets, and process deposits/withdrawals.

## Project Architecture
- **Backend**: Node.js with Express server (`server.js`)
- **Database**: PostgreSQL for persistent data storage
- **Real-time**: WebSocket for live game updates
- **Cache**: Redis (optional) for session management
- **Telegram Bot**: Integration for user notifications and game access

## Directory Structure
```
├── server.js        # Main Express server with all API routes
├── db/
│   └── database.js  # Database connection and initialization
├── models/
│   ├── Game.js      # Game model
│   ├── User.js      # User model
│   └── Wallet.js    # Wallet model
├── data/
│   └── cards.js     # Bingo card data and validation
├── public/          # Frontend static files
│   ├── index.html   # Main application page
│   ├── admin.html   # Admin panel
│   ├── style.css    # Styles
│   ├── game.js      # Game logic
│   └── card.js      # Card rendering
└── uploads/         # User uploaded files
```

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (auto-configured by Replit)
- `TELEGRAM_BOT_TOKEN` - Telegram bot token (optional)
- `JWT_SECRET` - Secret key for JWT tokens
- `REDIS_URL` - Redis connection URL (optional)
- `ADMIN_CHAT_ID` - Telegram chat ID for admin notifications

## Running the Application
The server runs on port 5000 and serves both the API and static frontend files.

## Recent Changes
- Initial Replit environment setup (Jan 2026)
