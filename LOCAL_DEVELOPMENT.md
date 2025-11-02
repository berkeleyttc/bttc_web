# Local Development Guide

This guide covers how to run the BTTC web application locally with or without the Netlify function proxy.

## Overview

The application has two configuration files:
- **`env.js`** - Frontend configuration (checked into git)
- **`.env`** - Backend secrets for Netlify function (NOT checked into git)

## Prerequisites

1. **Install Node.js** (if not already installed)
   - Download from https://nodejs.org/
   - Or use Homebrew: `brew install node`

2. **Install Netlify CLI** (only needed if testing with Netlify function proxy)
   ```bash
   npm install -g netlify-cli
   ```

## Option 1: Direct Backend Connection (Simpler)

Use this option if you're running the backend API locally and don't need to test the Netlify function proxy.

### Setup

1. **Update `env.js`** to point directly to your local backend:
   ```javascript
   const ENV = {
     API_URL: 'http://0.0.0.0:8080',  // Direct connection to backend
     // ... rest of config
   };
   ```

2. **Start your backend API** on port 8080

3. **Open the HTML files** directly in your browser:
   - Registration: `bttc_rr_registration_vue.html`
   - Roster: `bttc_roster_vue.html`
   - Player Signup: `bttc_player_signup_vue.html`

## Option 2: With Netlify Function Proxy (Production-like)

Use this option to test the full production setup including the Netlify function proxy.

### Setup

1. **Create `.env` file** (copy from example):
   ```bash
   cp env.example .env
   ```

2. **Edit `.env` file** with your backend credentials:
   ```env
   BTTC_API_URL=http://0.0.0.0:8080
   BTTC_API_KEY=your-secret-api-token
   ```
   
   These variables are used by the Netlify function (`netlify/functions/api.js`) to connect to your backend.

3. **Update `env.js`** to use the Netlify function:
   ```javascript
   const ENV = {
     API_URL: '/.netlify/functions/api',  // Use Netlify function proxy
     // ... rest of config
   };
   ```

### Running

1. **Start Netlify Dev** (runs functions and serves your site):
   ```bash
   netlify dev
   ```

   This will:
   - Start the Netlify Functions at `http://localhost:8888/.netlify/functions/api`
   - Serve your HTML files at `http://localhost:8888`
   - Load environment variables from `.env` file

2. **Access your site**:
   - Main site: `http://localhost:8888`
   - Registration: `http://localhost:8888/bttc_rr_registration_vue.html`
   - Roster: `http://localhost:8888/bttc_roster_vue.html`
   - Function endpoint: `http://localhost:8888/.netlify/functions/api`

### Testing the Function

Test the API proxy:
```bash
# Test roster endpoint
curl http://localhost:8888/.netlify/functions/api/rr/roster

# Test player search
curl "http://localhost:8888/.netlify/functions/api/player/search?type=lastname&value=Smith"

# Or open in browser
open http://localhost:8888/.netlify/functions/api/rr/roster
```

## Configuration Files Explained

### `env.js` (Frontend Configuration)
This file is loaded by the Vue.js applications and contains:
- `API_URL` - Where the frontend sends API requests
  - **Production/Netlify**: `'/.netlify/functions/api'` (uses proxy)
  - **Local with proxy**: `'/.netlify/functions/api'` (with netlify dev)
  - **Local direct**: `'http://0.0.0.0:8080'` (direct to backend)
- `SUPPORT_PHONE`, `SUPPORT_METHOD` - Contact information
- `REGISTRATION_OPENING_DAY`, etc. - Registration schedule
- `DEFAULT_PLAYER_CAP` - Capacity settings
- `CACHE_TTL_ROSTER` - Caching configuration

**Note**: This file is checked into git and deployed to production.

### `.env` (Backend Secrets)
This file contains secrets for the Netlify function:
- `BTTC_API_URL` - The actual backend API endpoint (hidden from frontend)
- `BTTC_API_KEY` - The secret API token (never exposed to frontend)

**Note**: This file is NOT checked into git (.gitignore). On Netlify, these are set as environment variables in the dashboard.

## How the Proxy Works

1. **Frontend** makes request to `/.netlify/functions/api/rr/roster`
2. **Netlify function** (`netlify/functions/api.js`) receives the request
3. **Function** extracts the path (`/rr/roster`) and adds it to `BTTC_API_URL`
4. **Function** adds the `BTTC_API_KEY` header to authenticate
5. **Function** forwards request to backend: `http://0.0.0.0:8080/rr/roster`
6. **Backend** processes request and returns response
7. **Function** forwards response back to frontend

This keeps your backend URL and API key hidden from the frontend code.

## Switching Between Local and Production

### For Production Deployment:
Ensure `env.js` has:
```javascript
API_URL: '/.netlify/functions/api',
```

### For Local Development:
Choose your approach:
- **Direct**: Set `API_URL: 'http://0.0.0.0:8080'` in `env.js`
- **With proxy**: Set `API_URL: '/.netlify/functions/api'` and run `netlify dev`

## Troubleshooting

### "undefined" in URL (e.g., `/undefined/rr/roster`)
- **Cause**: `API_URL` is not defined in `env.js`
- **Fix**: Uncomment and set `API_URL` in `env.js`

### Functions not loading
- Make sure Node.js is installed
- Ensure you're in the project directory
- Try `netlify dev --debug` for more info

### Environment variables not working
- Ensure `.env` file exists and has correct values
- Variables in `.env` are only available to Netlify functions, not frontend
- Frontend config is in `env.js`

### CORS errors
- The Netlify function handles CORS automatically
- If using direct connection, ensure your backend has CORS enabled

### API connection errors
- Check that backend is running on the correct port
- Verify `BTTC_API_URL` and `BTTC_API_KEY` are correct in `.env`
- Check backend logs for authentication errors

### 404 errors on roster/registration pages
- Ensure you're accessing the full filename (e.g., `bttc_roster_vue.html`)
- With Netlify dev, the server auto-serves HTML files
- Without Netlify dev, open files directly
