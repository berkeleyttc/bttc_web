# Running Netlify Functions Locally

## Prerequisites

1. **Install Node.js** (if not already installed)
   - Download from https://nodejs.org/
   - Or use Homebrew: `brew install node`

2. **Install Netlify CLI**
   ```bash
   npm install -g netlify-cli
   ```

## Setup

1. **Create environment file** (copy from example):
   ```bash
   cp env.example .env
   ```

2. **Edit `.env` file** with your actual values:
   ```env
   BTTC_API_URL=http://0.0.0.0:8080/
   BTTC_API_TOKEN=your-actual-secret-token
   ```

## Running Locally

1. **Start Netlify Dev** (runs functions and serves your site):
   ```bash
   netlify dev
   ```

   This will:
   - Start the Netlify Functions at `http://localhost:8888/.netlify/functions/api`
   - Serve your HTML files
   - Load environment variables from `.env` file

2. **Access your site**:
   - Main site: `http://localhost:8888`
   - Function endpoint: `http://localhost:8888/.netlify/functions/api`

## Testing the Function

Test your API proxy:
```bash
# Test via curl
curl http://localhost:8888/.netlify/functions/api/player/search?type=lastname&value=Galvankar

# Or open in browser
open http://localhost:8888/.netlify/functions/api/player/search?type=lastname&value=Galvankar
```

## Configuration

Update `config.js` for local development:
```javascript
const config = {
    scriptUrl: '/.netlify/functions/api'
};
```

Note: When running locally with `netlify dev`, it will automatically proxy to `http://localhost:8888/.netlify/functions/api`

## Troubleshooting

- **Functions not loading**: Make sure Node.js is installed and you're in the project directory
- **Environment variables not working**: Ensure `.env` file exists and has correct values
- **CORS errors**: The function handles CORS automatically
- **API connection errors**: Check that `BTTC_API_URL` and `BTTC_API_TOKEN` are correct in `.env`
