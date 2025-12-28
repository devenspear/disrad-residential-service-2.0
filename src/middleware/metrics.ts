import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import type { RequestMetrics, MetricsSummary, EndpointMetrics, ContentTypeMetrics } from '../types';
import { cacheStats } from '../utils/cache';

// Store metrics in memory (last 24 hours)
const MAX_METRICS_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const metrics: RequestMetrics[] = [];

// Clean old metrics periodically
setInterval(() => {
  const cutoff = new Date(Date.now() - MAX_METRICS_AGE_MS);
  while (metrics.length > 0 && metrics[0].timestamp < cutoff) {
    metrics.shift();
  }
}, 60 * 1000); // Every minute

/**
 * Middleware to track request metrics
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  // Track response finish event for metrics
  res.on('finish', () => {
    const latencyMs = Date.now() - startTime;

    // Extract content type from custom header or path
    const contentType = extractContentType(req);

    // Record metric
    const metric: RequestMetrics = {
      timestamp: new Date(),
      endpoint: req.path,
      method: req.method,
      statusCode: res.statusCode,
      latencyMs,
      success: res.statusCode >= 200 && res.statusCode < 400,
      contentType,
      errorType: res.locals.errorType,
    };

    metrics.push(metric);

    // Log slow requests
    if (latencyMs > 5000) {
      logger.warn(`Slow request: ${req.method} ${req.path}`, { latencyMs, statusCode: res.statusCode });
    }
  });

  next();
}

/**
 * Extract content type from request
 */
function extractContentType(req: Request): string | undefined {
  if (req.path.includes('/transcript')) return 'youtube';
  if (req.path.includes('/twitter')) return 'twitter';
  if (req.path.includes('/content')) return 'playwright';
  return undefined;
}

/**
 * Get metrics summary
 */
export function getMetricsSummary(period: '1h' | '24h' = '24h'): MetricsSummary {
  const cutoffMs = period === '1h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - cutoffMs);

  const filteredMetrics = metrics.filter(m => m.timestamp >= cutoff);

  // Calculate summary
  const totalRequests = filteredMetrics.length;
  const successfulRequests = filteredMetrics.filter(m => m.success).length;
  const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0;

  const latencies = filteredMetrics.map(m => m.latencyMs).sort((a, b) => a - b);
  const avgLatencyMs = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 0;
  const p95LatencyMs = latencies.length > 0
    ? latencies[Math.floor(latencies.length * 0.95)] || latencies[latencies.length - 1]
    : 0;

  // Group by endpoint
  const byEndpoint: Record<string, EndpointMetrics> = {};
  filteredMetrics.forEach(m => {
    if (!byEndpoint[m.endpoint]) {
      byEndpoint[m.endpoint] = { requests: 0, success: 0, failed: 0, avgLatency: 0 };
    }
    byEndpoint[m.endpoint].requests++;
    if (m.success) {
      byEndpoint[m.endpoint].success++;
    } else {
      byEndpoint[m.endpoint].failed++;
    }
    byEndpoint[m.endpoint].avgLatency =
      (byEndpoint[m.endpoint].avgLatency * (byEndpoint[m.endpoint].requests - 1) + m.latencyMs) /
      byEndpoint[m.endpoint].requests;
  });

  // Group by content type
  const byContentType: Record<string, ContentTypeMetrics> = {};
  filteredMetrics.filter(m => m.contentType).forEach(m => {
    const ct = m.contentType!;
    if (!byContentType[ct]) {
      byContentType[ct] = { requests: 0, success: 0, avgLatency: 0 };
    }
    byContentType[ct].requests++;
    if (m.success) byContentType[ct].success++;
    byContentType[ct].avgLatency =
      (byContentType[ct].avgLatency * (byContentType[ct].requests - 1) + m.latencyMs) /
      byContentType[ct].requests;
  });

  // Count errors by type
  const errors: Record<string, number> = {};
  filteredMetrics.filter(m => !m.success && m.errorType).forEach(m => {
    errors[m.errorType!] = (errors[m.errorType!] || 0) + 1;
  });

  return {
    period,
    summary: {
      totalRequests,
      successRate: Math.round(successRate * 100) / 100,
      avgLatencyMs: Math.round(avgLatencyMs),
      p95LatencyMs: Math.round(p95LatencyMs),
    },
    byEndpoint,
    byContentType,
    errors,
    cache: cacheStats(),
  };
}

/**
 * Record an error type for the current request
 */
export function setErrorType(res: Response, errorType: string): void {
  res.locals.errorType = errorType;
}

/**
 * Get raw metrics array (for debugging)
 */
export function getRawMetrics(): RequestMetrics[] {
  return [...metrics];
}

/**
 * Clear all metrics
 */
export function clearMetrics(): void {
  metrics.length = 0;
  logger.info('Metrics cleared');
}
