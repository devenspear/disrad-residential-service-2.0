import { Router, Request, Response } from 'express';
import { getMetricsSummary, clearMetrics, getRawMetrics } from '../middleware/metrics';
import { apiKeyAuth } from '../middleware/auth';
import { cacheStats, cacheClear } from '../utils/cache';
import { browserPool } from '../services/browser-pool';

const router = Router();

// All metrics routes require API key
router.use(apiKeyAuth);

/**
 * GET /metrics
 * Get service metrics summary
 */
router.get('/', (req: Request, res: Response) => {
  const period = req.query.period === '1h' ? '1h' : '24h';
  const summary = getMetricsSummary(period);
  res.json(summary);
});

/**
 * GET /metrics/cache
 * Get cache statistics
 */
router.get('/cache', (_req: Request, res: Response) => {
  res.json(cacheStats());
});

/**
 * DELETE /metrics/cache
 * Clear the cache
 */
router.delete('/cache', (_req: Request, res: Response) => {
  cacheClear();
  res.json({
    success: true,
    message: 'Cache cleared',
  });
});

/**
 * GET /metrics/browser
 * Get browser pool status
 */
router.get('/browser', (_req: Request, res: Response) => {
  res.json(browserPool.getStatus());
});

/**
 * GET /metrics/raw
 * Get raw metrics data (for debugging)
 */
router.get('/raw', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const metrics = getRawMetrics();
  res.json({
    total: metrics.length,
    metrics: metrics.slice(-limit),
  });
});

/**
 * DELETE /metrics
 * Clear all metrics
 */
router.delete('/', (_req: Request, res: Response) => {
  clearMetrics();
  res.json({
    success: true,
    message: 'Metrics cleared',
  });
});

export default router;
