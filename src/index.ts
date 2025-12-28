import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config, validateConfig } from './config';
import { logger } from './utils/logger';
import { rateLimit } from './middleware/rateLimit';
import { requestLogger } from './middleware/logging';
import { metricsMiddleware } from './middleware/metrics';
import { browserPool } from './services/browser-pool';

// Routes
import healthRouter from './routes/health';
import transcriptRouter from './routes/transcript';
import contentRouter from './routes/content';
import twitterRouter from './routes/twitter';
import metricsRouter from './routes/metrics';
import versionRouter from './routes/version';

const app = express();

// Validate configuration
validateConfig();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: '*', // Cloudflare tunnel handles security
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
}));

// Body parsing
app.use(express.json());

// Request logging
app.use(requestLogger);

// Metrics tracking
app.use(metricsMiddleware);

// Rate limiting
app.use(rateLimit);

// Public endpoints (no auth)
app.get('/ping', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/health', healthRouter);
app.use('/transcript', transcriptRouter);
app.use('/content', contentRouter);
app.use('/twitter', twitterRouter);
app.use('/metrics', metricsRouter);
app.use('/version', versionRouter);

// Root endpoint - API documentation
app.get('/', (_req, res) => {
  res.json({
    service: config.serviceName,
    version: config.version,
    description: 'Disruption Radar Residential Content Service',
    endpoints: {
      public: {
        ping: 'GET /ping',
        health: 'GET /health',
        version: 'GET /version',
      },
      authenticated: {
        healthDetailed: 'GET /health/detailed',
        transcript: {
          single: 'GET /transcript?videoId={id}&language={lang}',
          batch: 'POST /transcript/batch',
          cache: 'GET /transcript/cache',
          clearCache: 'DELETE /transcript/cache',
        },
        content: {
          fetch: 'POST /content/fetch',
          fetchGet: 'GET /content/fetch?url={url}',
        },
        twitter: {
          content: 'POST /twitter/content',
          contentGet: 'GET /twitter/content?url={url}',
          validate: 'POST /twitter/validate',
        },
        metrics: {
          summary: 'GET /metrics?period={1h|24h}',
          cache: 'GET /metrics/cache',
          browser: 'GET /metrics/browser',
          raw: 'GET /metrics/raw?limit={n}',
          clear: 'DELETE /metrics',
          clearCache: 'DELETE /metrics/cache',
        },
        version: {
          check: 'POST /version/check',
          features: 'GET /version/features',
        },
      },
    },
    authentication: {
      header: 'X-API-Key',
      description: 'Include your API key in the X-API-Key header',
    },
    documentation: 'https://github.com/devenspear/disrad-residential-service-2.0',
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function start() {
  // Warm up browser pool
  try {
    await browserPool.warmup();
  } catch (error) {
    logger.warn('Browser pool warmup failed, will initialize on first request', { error });
  }

  app.listen(config.port, '0.0.0.0', () => {
    logger.info(`${config.serviceName} v${config.version} started`);
    logger.info(`Port: ${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    logger.info(`Health check: http://localhost:${config.port}/health`);
    logger.info(`API docs: http://localhost:${config.port}/`);
  });
}

start().catch(error => {
  logger.error('Failed to start server', { error });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await browserPool.cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await browserPool.cleanup();
  process.exit(0);
});
