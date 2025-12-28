import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100');

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip || 'unknown';
  const now = Date.now();

  let entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + WINDOW_MS };
    rateLimitMap.set(key, entry);
  }

  entry.count++;

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS.toString());
  res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - entry.count).toString());
  res.setHeader('X-RateLimit-Reset', entry.resetTime.toString());

  if (entry.count > MAX_REQUESTS) {
    logger.warn(`Rate limit exceeded for ${key}`);
    res.status(429).json({
      error: 'Too many requests',
      retryAfter: Math.ceil((entry.resetTime - now) / 1000),
    });
    return;
  }

  next();
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, 60000);
