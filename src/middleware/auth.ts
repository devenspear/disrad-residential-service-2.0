import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string;
  const expectedKey = process.env.API_KEY;

  if (!expectedKey) {
    logger.error('API_KEY not configured in environment');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  if (!apiKey) {
    logger.warn(`Missing API key from ${req.ip}`);
    res.status(401).json({ error: 'API key required' });
    return;
  }

  if (apiKey !== expectedKey) {
    logger.warn(`Invalid API key attempt from ${req.ip}`);
    res.status(403).json({ error: 'Invalid API key' });
    return;
  }

  next();
}
