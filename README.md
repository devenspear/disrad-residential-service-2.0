# Universal Residential Content Service

A comprehensive residential content fetching service for Disruption Radar. Provides YouTube transcript extraction, universal webpage content scraping via Playwright, and Twitter content retrieval - all from a residential IP to bypass cloud IP blocks.

## Features

- **YouTube Transcripts**: Fetch video transcripts using yt-dlp (more reliable than npm packages)
- **Universal Content Extraction**: Scrape any webpage using Playwright browser automation
- **Twitter/X Content**: Extract tweets and Twitter articles
- **Browser Pool**: Managed Chromium instances with automatic cleanup
- **LRU Caching**: In-memory caching with configurable TTL
- **API Key Authentication**: Secure access control
- **Rate Limiting**: 100 requests/minute per IP
- **Comprehensive Metrics**: Track success rates, latency, and errors
- **Health Monitoring**: Detailed health endpoint with browser status

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Framework**: Express.js
- **Browser Automation**: Playwright (Chromium)
- **YouTube**: yt-dlp CLI
- **Caching**: LRU Cache
- **Logging**: Winston

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd residential-service-new

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Create environment file
cp .env.example .env
# Edit .env with your configuration
```

### Prerequisites

- Node.js 20+
- yt-dlp installed and in PATH (for YouTube transcripts)
  ```cmd
  winget install yt-dlp
  ```

## Configuration

Create a `.env` file:

```env
# Server
PORT=3100
NODE_ENV=production

# Authentication
API_KEY=your-32-character-api-key-here

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Browser Pool
BROWSER_MAX_CONTEXTS=3
BROWSER_CONTEXT_TIMEOUT_MS=60000
BROWSER_PAGE_TIMEOUT_MS=30000

# Cache
CACHE_MAX_SIZE=100
CACHE_TTL_SECONDS=300

# Logging
LOG_LEVEL=info

# yt-dlp path (Windows)
YT_DLP_PATH=C:\Users\Deven Spear\AppData\Local\Microsoft\WinGet\Links\yt-dlp.exe
```

## Running the Service

```bash
# Development mode (with hot reload)
npm run dev

# Production build
npm run build
npm start
```

## API Endpoints

### Public Endpoints (No Auth)

#### Ping
```
GET /ping
```
Simple health check for monitoring tools like Uptime Kuma.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-12-28T04:00:00.000Z"
}
```

### Authenticated Endpoints

All authenticated endpoints require the `X-API-Key` header.

#### Health Check
```
GET /health
```

Returns detailed service status including browser pool state.

**Response:**
```json
{
  "status": "operational",
  "version": "1.0.0",
  "uptime": 3600,
  "uptimeFormatted": "1h 0m 0s",
  "startedAt": "2025-12-28T03:00:00.000Z",
  "system": {
    "hostname": "DevOfficeMiniPC",
    "platform": "win32",
    "arch": "x64",
    "nodeVersion": "v24.12.0",
    "memory": { "free": 4000, "total": 8000, "usagePercent": 50 },
    "cpu": { "model": "Intel(R) N95", "cores": 4 }
  },
  "browser": {
    "status": "ready",
    "version": "143.0.7499.4",
    "activeContexts": 0,
    "maxContexts": 3,
    "totalPagesCreated": 0
  }
}
```

#### Fetch YouTube Transcript
```
GET /transcript?videoId=<video-id>&language=<optional>
POST /transcript (body: { videoId, language })
```

**Query Parameters / Body:**
- `videoId` (required): YouTube video ID or full URL
- `language` (optional): Language code (default: `en`)

**Response:**
```json
{
  "success": true,
  "videoId": "dQw4w9WgXcQ",
  "segments": [
    { "text": "Never gonna give you up", "start": 18.8, "duration": 3.5 }
  ],
  "fullText": "Never gonna give you up...",
  "wordCount": 291,
  "language": "en",
  "source": "yt-dlp",
  "fetchTimeMs": 5067
}
```

#### Fetch Universal Content (Playwright)
```
POST /content/fetch
```

Extracts content from any webpage using Playwright browser automation.

**Body:**
```json
{
  "url": "https://example.com",
  "contentType": "auto",
  "waitFor": ".article-body",
  "timeout": 30000
}
```

**Response:**
```json
{
  "success": true,
  "url": "https://example.com",
  "content": {
    "text": "Extracted page content..."
  },
  "metadata": {
    "title": "Page Title",
    "author": "Author Name",
    "publishedAt": "2025-01-01",
    "wordCount": 500,
    "fetchedAt": "2025-12-28T04:00:00.000Z",
    "method": "playwright",
    "latencyMs": 2500
  }
}
```

#### Fetch Twitter Content
```
POST /twitter/content
```

Extracts content from Twitter/X posts and articles.

**Body:**
```json
{
  "url": "https://twitter.com/user/status/123456789"
}
```

#### Get Metrics
```
GET /metrics
```

Returns usage statistics and error rates.

**Response:**
```json
{
  "summary": {
    "totalRequests24h": 150,
    "successRate24h": 95.5,
    "avgLatencyMs": 3200
  },
  "byContentType": {
    "youtube": { "requests": 100, "success": 98, "avgLatency": 5000 },
    "playwright": { "requests": 50, "success": 45, "avgLatency": 2500 }
  },
  "errors": {
    "TranscriptNotFound": 5,
    "Timeout": 2
  },
  "cache": {
    "size": 50,
    "maxSize": 100,
    "hitRate": 0.35
  }
}
```

## Error Types

The service returns specific error types to help with handling:

| Error Type | Description | Retryable |
|------------|-------------|-----------|
| `TranscriptNotFound` | Video has no captions | No |
| `TranscriptsDisabled` | Creator disabled captions | No |
| `VideoNotFound` | Video doesn't exist | No |
| `PrivateVideo` | Video is private | No |
| `AgeRestricted` | Age-gated content | No |
| `Timeout` | Request timed out | Yes |
| `NetworkError` | Network connectivity issue | Yes |
| `ServerError` | Internal server error | Yes |
| `Blocked` | Site blocked the request | Maybe |

## Deployment

The service runs on **Windows Server** at `192.168.0.50:3100` behind a Cloudflare Tunnel.

**Public URL:** `https://transcript.cloudtunnel.dev`

### Windows Service Management

The service runs via Windows Task Scheduler:

```cmd
# Start the service
schtasks /run /tn "ResidentialContentService"

# Check status
schtasks /query /tn "ResidentialContentService"

# View running task
schtasks /query /tn "ResidentialContentService" /v /fo list
```

### Directory Structure

```
C:\Projects\
├── residential-service-new/   # Active service
└── uptime-kuma/               # Monitoring dashboard
```

---

## Monitoring with Uptime Kuma

The service is monitored using [Uptime Kuma](https://github.com/louislam/uptime-kuma).

**Dashboard:** `http://192.168.0.50:3001`

### Service Management

```cmd
# Start Uptime Kuma
schtasks /run /tn "UptimeKuma"

# Check Status
schtasks /query /tn "UptimeKuma"
```

### Monitor Configuration

| Setting | Value |
|---------|-------|
| Monitor Type | HTTP(s) |
| URL | `http://localhost:3100/health` |
| Heartbeat Interval | 60 seconds |
| Retries | 3 |

### Auto-Start on Boot

Both services are configured to auto-start via Windows Task Scheduler:
- `ResidentialContentService` - Content API (port 3100)
- `UptimeKuma` - Monitoring dashboard (port 3001)

---

## Project Structure

```
residential-service-new/
├── src/
│   ├── index.ts                    # Express app entry point
│   ├── config.ts                   # Configuration management
│   ├── middleware/
│   │   ├── auth.ts                 # API key authentication
│   │   ├── rate-limit.ts           # Rate limiting
│   │   └── metrics.ts              # Request metrics tracking
│   ├── routes/
│   │   ├── health.ts               # Health check endpoint
│   │   ├── transcript.ts           # YouTube transcript endpoints
│   │   ├── content.ts              # Universal content extraction
│   │   ├── twitter.ts              # Twitter content extraction
│   │   └── metrics.ts              # Metrics endpoint
│   ├── services/
│   │   ├── youtube-transcript.ts   # yt-dlp based transcript fetching
│   │   ├── content-extractor.ts    # Playwright content extraction
│   │   ├── twitter-extractor.ts    # Twitter scraping
│   │   └── browser-pool.ts         # Chromium browser pool management
│   ├── utils/
│   │   ├── logger.ts               # Winston logger config
│   │   └── cache.ts                # LRU cache implementation
│   └── types/
│       └── index.ts                # TypeScript type definitions
├── dist/                           # Compiled JavaScript
├── .env                            # Environment configuration
├── package.json
├── tsconfig.json
└── README.md
```

## Integration with Disruption Radar

This service integrates with Disruption Radar 2.0 via the residential client:

```typescript
import { residentialClient } from '@/lib/residential/client';

// Fetch transcript with retry
const result = await residentialClient.fetchTranscriptWithRetry({
  videoId: 'dQw4w9WgXcQ',
  languages: ['en']
});

// Fetch webpage content
const content = await residentialClient.fetchContentWithRetry({
  url: 'https://example.com',
  timeout: 30000
});

// Check service health
const health = await residentialClient.getHealth();
```

## License

MIT License - Deven Spear
