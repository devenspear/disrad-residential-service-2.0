import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { rateLimit } from './middleware/rateLimit';
import { requestLogger } from './middleware/logging';
import healthRouter from './routes/health';
import transcriptRouter from './routes/transcript';

// Load environment variables
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3100');

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

// Rate limiting
app.use(rateLimit);

// Routes
app.use('/health', healthRouter);
app.use('/transcript', transcriptRouter);

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    service: 'Transcript Service',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      transcript: 'GET /transcript?videoId={id}',
      batch: 'POST /transcript/batch',
    },
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
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Transcript Service started on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});
