# Royal Bingo - Telegram Bingo Game

## Overview
Royal Bingo is a web-based Bingo game integrated with Telegram. Users can play Bingo games, manage their wallets (deposits/withdrawals), and interact through a Telegram bot.

## Project Architecture

### Tech Stack
- **Backend**: Node.js with Express.js
- **Database**: PostgreSQL (via Replit's built-in database)
- **Real-time**: WebSocket (ws library) for live game updates
- **Optional Cache**: Redis/Upstash for real-time game state (falls back to memory if not configured)
- **Telegram Integration**: node-telegram-bot-api for bot functionality

### Project Structure
```
├── server.js           # Main Express server with all API routes and WebSocket handling
├── db/
│   └── database.js     # PostgreSQL connection pool and schema initialization
├── models/
│   ├── User.js         # User model and authentication logic
│   ├── Wallet.js       # Wallet operations (deposits, withdrawals, balance)
│   └── Game.js         # Game logic and participant management
├── public/
│   ├── index.html      # Main frontend UI
│   ├── admin.html      # Admin dashboard
│   ├── style.css       # Application styles
│   ├── game.js         # Frontend game logic
│   ├── card.js         # Bingo card generation/rendering
│   └── images/         # Static images
└── data/
    └── cards.js        # Bingo card validation logic
```

### Database Schema
Tables managed via `db/database.js`:
- `users` - User accounts with Telegram integration
- `wallets` - User balances (deposit and win balance)
- `transactions` - All financial transactions
- `games` - Active and completed games
- `game_participants` - Players in each game
- `deposits` - Pending and confirmed deposits
- `withdrawals` - Pending and processed withdrawals
- `winners` - Game winners history
- `admin_users` - Admin accounts
- `referrals` - Referral bonuses tracking

### Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (automatically configured)
- `TELEGRAM_BOT_TOKEN` - (Optional) Telegram bot token for bot features
- `JWT_SECRET` - Secret for JWT token generation (has default fallback)
- `REDIS_URL` - (Optional) Redis URL for real-time game state caching
- `ADMIN_CHAT_ID` - (Optional) Telegram chat ID for admin notifications

## Running the Application
The application runs on port 5000 and binds to 0.0.0.0 for Replit compatibility.

**Development**: `npm start`
**Production**: `node server.js`

## Recent Changes
- January 2026: Initial import and setup for Replit environment
- Configured PostgreSQL database
- Set up deployment configuration

## User Preferences
- Language: Amharic (Ethiopian) with English labels
- Currency: ETB (Ethiopian Birr)
