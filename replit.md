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
- `DATABASE_URL` - PostgreSQL connection string (auto-configured)
- `TELEGRAM_BOT_TOKEN` - Telegram bot token (optional)
- `ADMIN_CHAT_ID` - Telegram chat ID for admin user
- `JWT_SECRET` - Secret for JWT tokens
- `REDIS_URL` - Redis connection URL (optional)

## Running the Application
The server runs on port 5000 and serves static files from the `/public` directory.

## Recent Changes
- 2026-01-24: Initial setup on Replit
  - Created directory structure (db/, models/, data/, public/)
  - Moved source files to appropriate directories
  - Configured PostgreSQL database
  - Set up workflow for port 5000
