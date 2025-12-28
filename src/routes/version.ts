import { Router, Request, Response } from 'express';
import { config } from '../config';
import { apiKeyAuth } from '../middleware/auth';
import type { VersionInfo, CompatibilityCheck } from '../types';

const router = Router();

// Service version metadata
const versionInfo: VersionInfo = {
  service: config.serviceName,
  version: config.version,
  minClientVersion: '2.0.0', // Minimum client version required
  apiVersion: 'v1',
  features: [
    'youtube-transcript',
    'twitter-content',
    'playwright-content',
    'lru-cache',
    'metrics',
    'browser-pool',
  ],
};

/**
 * GET /version (no auth)
 * Get service version info
 */
router.get('/', (_req: Request, res: Response) => {
  res.json(versionInfo);
});

/**
 * POST /version/check (auth required)
 * Check client version compatibility
 */
router.post('/check', apiKeyAuth, (req: Request, res: Response) => {
  const { clientVersion } = req.body;

  if (!clientVersion || typeof clientVersion !== 'string') {
    res.status(400).json({
      success: false,
      error: 'clientVersion is required in request body',
    });
    return;
  }

  const compatibility = checkCompatibility(clientVersion);
  res.json(compatibility);
});

/**
 * GET /version/features (auth required)
 * Get list of supported features
 */
router.get('/features', apiKeyAuth, (_req: Request, res: Response) => {
  res.json({
    version: config.version,
    features: versionInfo.features,
    endpoints: {
      transcript: {
        supported: true,
        methods: ['GET', 'POST'],
        batchSupport: true,
      },
      content: {
        supported: true,
        methods: ['GET', 'POST'],
        playwright: true,
      },
      twitter: {
        supported: true,
        methods: ['GET', 'POST'],
      },
      metrics: {
        supported: true,
        periods: ['1h', '24h'],
      },
    },
  });
});

/**
 * Check if a client version is compatible with this service
 */
function checkCompatibility(clientVersion: string): CompatibilityCheck {
  const warnings: string[] = [];

  // Parse versions
  const clientParts = parseVersion(clientVersion);
  const serviceParts = parseVersion(config.version);
  const minParts = parseVersion(versionInfo.minClientVersion);

  // Check if client version is valid
  if (!clientParts) {
    return {
      compatible: false,
      serviceVersion: config.version,
      clientVersion,
      warnings: ['Invalid client version format. Expected semver (e.g., 2.0.0)'],
    };
  }

  // Service and min versions should always parse correctly
  if (!serviceParts || !minParts) {
    return {
      compatible: false,
      serviceVersion: config.version,
      clientVersion,
      warnings: ['Internal error: Invalid service version configuration'],
    };
  }

  // Check if client is too old
  if (compareVersions(clientParts, minParts) < 0) {
    return {
      compatible: false,
      serviceVersion: config.version,
      clientVersion,
      warnings: [`Client version ${clientVersion} is below minimum required ${versionInfo.minClientVersion}`],
    };
  }

  // Check if client is newer than service (minor warning)
  if (clientParts.major > serviceParts.major) {
    warnings.push(`Client major version (${clientParts.major}) is ahead of service (${serviceParts.major}). Some features may not work.`);
  }

  // Compatible
  return {
    compatible: true,
    serviceVersion: config.version,
    clientVersion,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Parse a semver string into components
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Compare two parsed versions
 * Returns: -1 if a < b, 0 if equal, 1 if a > b
 */
function compareVersions(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number }
): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

export default router;
