import { Router, Request, Response } from 'express';
import { fetchContent } from '../services/content-extractor';
import { apiKeyAuth } from '../middleware/auth';
import { setErrorType } from '../middleware/metrics';
import { logger } from '../utils/logger';
import type { ContentFetchRequest } from '../types';

const router = Router();

// All content routes require API key
router.use(apiKeyAuth);

/**
 * POST /content/fetch
 * Fetch content from any URL using Playwright
 */
router.post('/fetch', async (req: Request, res: Response) => {
  const { url, contentType, waitFor, timeout } = req.body as ContentFetchRequest;

  if (!url || typeof url !== 'string') {
    res.status(400).json({
      success: false,
      error: 'url is required in request body',
    });
    return;
  }

  try {
    const result = await fetchContent({
      url,
      contentType,
      waitFor,
      timeout,
    });

    if (result.success) {
      res.json(result);
    } else {
      if (result.errorType) {
        setErrorType(res, result.errorType);
      }
      res.status(getStatusCode(result.errorType)).json(result);
    }
  } catch (error) {
    logger.error('Unexpected error in content fetch', { error });
    res.status(500).json({
      success: false,
      url,
      error: 'Internal server error',
      errorType: 'ServerError',
    });
  }
});

/**
 * GET /content/fetch?url=xxx
 * Alternative GET endpoint for simple fetches
 */
router.get('/fetch', async (req: Request, res: Response) => {
  const { url, waitFor, timeout } = req.query;

  if (!url || typeof url !== 'string') {
    res.status(400).json({
      success: false,
      error: 'url query parameter is required',
    });
    return;
  }

  try {
    const result = await fetchContent({
      url,
      waitFor: typeof waitFor === 'string' ? waitFor : undefined,
      timeout: typeof timeout === 'string' ? parseInt(timeout, 10) : undefined,
    });

    if (result.success) {
      res.json(result);
    } else {
      if (result.errorType) {
        setErrorType(res, result.errorType);
      }
      res.status(getStatusCode(result.errorType)).json(result);
    }
  } catch (error) {
    logger.error('Unexpected error in content fetch', { error });
    res.status(500).json({
      success: false,
      url,
      error: 'Internal server error',
      errorType: 'ServerError',
    });
  }
});

/**
 * Map error type to HTTP status code
 */
function getStatusCode(errorType?: string): number {
  switch (errorType) {
    case 'InvalidUrl':
      return 400;
    case 'NotFound':
      return 404;
    case 'Blocked':
      return 403;
    case 'Timeout':
      return 504;
    case 'NetworkError':
    case 'ServerError':
    default:
      return 500;
  }
}

export default router;
