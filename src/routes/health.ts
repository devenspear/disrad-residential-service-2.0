import { Router, Request, Response } from 'express';
import os from 'os';
import { config } from '../config';
import { browserPool } from '../services/browser-pool';
import { cacheStats } from '../utils/cache';
import { apiKeyAuth } from '../middleware/auth';
import type { ServiceHealth } from '../types';

const router = Router();
const startTime = new Date();

/**
 * GET /health (no auth required)
 * Basic health check for monitoring tools
 */
router.get('/', (_req: Request, res: Response) => {
  const uptimeSeconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
  const browserStatus = browserPool.getStatus();

  // Determine overall status
  let status: ServiceHealth['status'] = 'operational';
  if (browserStatus.status === 'error') {
    status = 'degraded';
  }

  const health: ServiceHealth = {
    status,
    version: config.version,
    uptime: uptimeSeconds,
    uptimeFormatted: formatUptime(uptimeSeconds),
    startedAt: startTime.toISOString(),
    system: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      memory: {
        free: Math.round(os.freemem() / 1024 / 1024),
        total: Math.round(os.totalmem() / 1024 / 1024),
        usagePercent: Math.round((1 - os.freemem() / os.totalmem()) * 100),
      },
      cpu: {
        model: os.cpus()[0]?.model || 'Unknown',
        cores: os.cpus().length,
      },
    },
    browser: browserStatus,
    cache: cacheStats(),
  };

  res.json(health);
});

/**
 * GET /health/detailed (auth required)
 * Detailed health info with full diagnostics
 */
router.get('/detailed', apiKeyAuth, (_req: Request, res: Response) => {
  const uptimeSeconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
  const browserStatus = browserPool.getStatus();
  const cache = cacheStats();

  res.json({
    status: browserStatus.status === 'error' ? 'degraded' : 'operational',
    version: config.version,
    uptime: uptimeSeconds,
    uptimeFormatted: formatUptime(uptimeSeconds),
    startedAt: startTime.toISOString(),
    config: {
      port: config.port,
      nodeEnv: config.nodeEnv,
      browserMaxContexts: config.browserMaxContexts,
      cacheMaxSize: config.cacheMaxSize,
      cacheTtlSeconds: config.cacheTtlSeconds,
      rateLimitMaxRequests: config.rateLimitMaxRequests,
    },
    system: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      memory: {
        free: Math.round(os.freemem() / 1024 / 1024),
        total: Math.round(os.totalmem() / 1024 / 1024),
        usagePercent: Math.round((1 - os.freemem() / os.totalmem()) * 100),
      },
      cpu: {
        model: os.cpus()[0]?.model || 'Unknown',
        cores: os.cpus().length,
        load: os.loadavg(),
      },
    },
    browser: browserStatus,
    cache,
    environment: {
      hasApiKey: !!process.env.API_KEY,
    },
  });
});

/**
 * GET /ping (no auth required)
 * Simple ping for uptime monitoring
 */
router.get('/ping', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}

export default router;
