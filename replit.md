# Royal Bingo

## Overview
A Telegram-integrated Bingo game built with Node.js/Express. Users can play bingo games with real money stakes, manage wallets, and participate via a Telegram Mini App.

## Project Structure
- `server.js` - Main Express server with WebSocket support, Telegram bot integration, and all API routes
- `db/database.js` - PostgreSQL database connection and initialization
- `models/` - Database models (User, Wallet, Game)
- `data/cards.js` - Bingo card validation logic
- `public/` - Frontend static files (HTML, CSS, JS)
  - `index.html` - Main app interface
  - `admin.html` - Admin dashboard
  - `style.css` - Styling
  - `game.js` - Game logic
  - `card.js` - Card rendering

## Tech Stack
- **Runtime**: Node.js 20
- **Framework**: Express 5.x
- **Database**: PostgreSQL (Replit built-in)
- **Real-time**: WebSocket (ws)
- **Bot**: node-telegram-bot-api
- **Cache**: Redis (optional, Upstash compatible)

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (auto-configured)
- `TELEGRAM_BOT_TOKEN` - Telegram bot token (optional)
- `JWT_SECRET` - Secret for JWT tokens
- `ADMIN_CHAT_ID` - Telegram admin chat ID
- `REDIS_URL` - Redis connection (optional)

## Running the App
The app runs on port 5000 and serves both the API and static frontend files.

## Recent Changes
- 2026-02-04: Imported to Replit, configured PostgreSQL database and workflow
