# DisRad Residential Service 2.0

Disruption Radar Residential Content Service - a comprehensive content fetching service that provides YouTube transcript extraction, universal webpage content scraping via Playwright, and Twitter/X content retrieval from a residential IP to bypass cloud IP blocks.

## Why Residential IP?

Many content sources (YouTube, Twitter/X, protected websites) block or rate-limit requests from cloud IP addresses (AWS, Vercel, Google Cloud). This service runs on a Windows PC with a residential IP address, routing through Cloudflare Tunnel, to achieve near 100% content extraction success rates.

## Features

- **YouTube Transcripts**: Fetch video transcripts using the youtube-transcript library
- **Universal Content Extraction**: Scrape any webpage using Playwright browser automation
- **Twitter/X Content**: Extract tweets and Twitter articles
- **Browser Pool**: Managed Chromium instances with automatic cleanup
- **LRU Caching**: In-memory caching with configurable TTL
- **API Key Authentication**: Secure access control
- **Rate Limiting**: 100 requests/minute per IP
- **Comprehensive Metrics**: Track success rates, latency, and errors
- **Health Monitoring**: Detailed health endpoint with browser status
- **Version Compatibility**: API versioning for client compatibility

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Framework**: Express.js
- **Browser Automation**: Playwright (Chromium)
- **Caching**: LRU Cache
- **Logging**: Winston

## Installation

```bash
# Clone the repository
git clone https://github.com/devenspear/disrad-residential-service-2.0.git
cd DisRad-Residential-Service-2.0

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Create environment file
cp .env.example .env
# Edit .env with your configuration

# Build TypeScript
npm run build

# Start the service
npm start
```

### Prerequisites

- Node.js 20+
- Chromium (installed via Playwright)

## Configuration

Create a `.env` file based on `.env.example`:

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
CACHE_TTL_SECONDS=3600

# Logging
LOG_LEVEL=info
```

## Running the Service

```bash
# Development mode (with hot reload)
npm run dev

# Production build and start
npm run build
npm start
```

## API Endpoints

### Public Endpoints (No Auth Required)

| Endpoint | Description |
|----------|-------------|
| `GET /ping` | Simple health check for monitoring tools |
| `GET /health` | Service health with browser and cache status |
| `GET /version` | Service version information |

### Authenticated Endpoints

All authenticated endpoints require the `X-API-Key` header.

#### YouTube Transcripts

| Endpoint | Description |
|----------|-------------|
| `GET /transcript?videoId={id}` | Fetch transcript for a video |
| `POST /transcript/batch` | Fetch transcripts for multiple videos |
| `GET /transcript/cache` | Get cache statistics |
| `DELETE /transcript/cache` | Clear transcript cache |

**Request Parameters:**
- `videoId` (required): YouTube video ID or full URL
- `language` (optional): Language code (default: `en`)

**Example Response:**
```json
{
  "success": true,
  "videoId": "dQw4w9WgXcQ",
  "transcript": {
    "fullText": "Never gonna give you up...",
    "segments": [
      { "text": "Never gonna give you up", "start": 18.8, "duration": 3.5 }
    ],
    "language": "en",
    "wordCount": 291
  },
  "fetchTimeMs": 2500
}
```

#### Universal Content Extraction

| Endpoint | Description |
|----------|-------------|
| `POST /content/fetch` | Extract content from any URL |
| `GET /content/fetch?url={url}` | Alternative GET endpoint |

**Request Body:**
```json
{
  "url": "https://example.com",
  "waitFor": ".article-body",
  "timeout": 30000
}
```

**Example Response:**
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
    "wordCount": 500,
    "method": "playwright",
    "latencyMs": 2500
  }
}
```

#### Twitter/X Content

| Endpoint | Description |
|----------|-------------|
| `POST /twitter/content` | Extract content from a tweet |
| `GET /twitter/content?url={url}` | Alternative GET endpoint |
| `POST /twitter/validate` | Validate a Twitter URL |

**Request Body:**
```json
{
  "url": "https://x.com/user/status/123456789"
}
```

#### Metrics

| Endpoint | Description |
|----------|-------------|
| `GET /metrics?period={1h\|24h}` | Get metrics summary |
| `GET /metrics/cache` | Get cache statistics |
| `GET /metrics/browser` | Get browser pool status |
| `DELETE /metrics` | Clear all metrics |

#### Version Compatibility

| Endpoint | Description |
|----------|-------------|
| `POST /version/check` | Check client version compatibility |
| `GET /version/features` | List supported features |

## Error Types

The service returns specific error types for proper error handling:

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

The service is designed to run on a Windows PC with a residential IP address behind a Cloudflare Tunnel.

**Public URL:** `https://transcript.cloudtunnel.dev`

### Windows Service Management

The service can run via Windows Task Scheduler:

```cmd
# Start the service
schtasks /run /tn "ResidentialContentService"

# Check status
schtasks /query /tn "ResidentialContentService"
```

## Integration with Disruption Radar 2.0

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

// Check version compatibility
const compat = await residentialClient.checkVersion('2.0.0');
```

## Project Structure

```
DisRad-Residential-Service-2.0/
├── src/
│   ├── index.ts                    # Express app entry point
│   ├── config.ts                   # Configuration management
│   ├── middleware/
│   │   ├── auth.ts                 # API key authentication
│   │   ├── logging.ts              # Request logging
│   │   ├── metrics.ts              # Metrics tracking
│   │   └── rateLimit.ts            # Rate limiting
│   ├── routes/
│   │   ├── health.ts               # Health check endpoints
│   │   ├── transcript.ts           # YouTube transcript endpoints
│   │   ├── content.ts              # Universal content extraction
│   │   ├── twitter.ts              # Twitter content extraction
│   │   ├── metrics.ts              # Metrics endpoint
│   │   └── version.ts              # Version compatibility
│   ├── services/
│   │   ├── youtube.ts              # YouTube transcript service
│   │   ├── content-extractor.ts    # Playwright content extraction
│   │   ├── twitter-extractor.ts    # Twitter scraping
│   │   └── browser-pool.ts         # Chromium browser pool
│   ├── utils/
│   │   ├── logger.ts               # Winston logger
│   │   └── cache.ts                # LRU cache
│   └── types/
│       └── index.ts                # TypeScript types
├── dist/                           # Compiled JavaScript
├── .env.example                    # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

## Version History

- **2.0.0** - Complete rewrite with Playwright, Twitter support, metrics, and version compatibility

## License

MIT License - Deven Spear
