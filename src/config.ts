import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './utils/logger';

dotenv.config();

// Read version from package.json
function getVersion(): string {
  try {
    const packagePath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    return packageJson.version || '2.0.1';
  } catch {
    return '2.0.1';
  }
}
const VERSION = getVersion();

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    logger.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function optionalNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export const config = {
  // Server
  port: optionalNumber('PORT', 3100),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),

  // Security
  apiKey: requiredEnv('API_KEY'),

  // Rate limiting
  rateLimitWindowMs: optionalNumber('RATE_LIMIT_WINDOW_MS', 60000),
  rateLimitMaxRequests: optionalNumber('RATE_LIMIT_MAX_REQUESTS', 100),

  // Browser pool (Playwright)
  browserMaxContexts: optionalNumber('BROWSER_MAX_CONTEXTS', 3),
  browserContextTimeoutMs: optionalNumber('BROWSER_CONTEXT_TIMEOUT_MS', 60000),
  browserPageTimeoutMs: optionalNumber('BROWSER_PAGE_TIMEOUT_MS', 30000),

  // Cache
  cacheMaxSize: optionalNumber('CACHE_MAX_SIZE', 100),
  cacheTtlSeconds: optionalNumber('CACHE_TTL_SECONDS', 3600),

  // Logging
  logLevel: optionalEnv('LOG_LEVEL', 'info'),

  // Service metadata
  version: VERSION,
  serviceName: 'DisRad-Residential-Service',
} as const;

export type Config = typeof config;

// Validate config on startup
export function validateConfig(): void {
  logger.info('Configuration loaded', {
    port: config.port,
    nodeEnv: config.nodeEnv,
    browserMaxContexts: config.browserMaxContexts,
    cacheMaxSize: config.cacheMaxSize,
    cacheTtlSeconds: config.cacheTtlSeconds,
    version: config.version,
  });
}
