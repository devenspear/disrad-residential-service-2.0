import { Router, Request, Response } from 'express';
import { fetchTwitterContent, isTwitterUrl } from '../services/twitter-extractor';
import { apiKeyAuth } from '../middleware/auth';
import { setErrorType } from '../middleware/metrics';
import { logger } from '../utils/logger';
import type { TwitterContentRequest } from '../types';

const router = Router();

// All Twitter routes require API key
router.use(apiKeyAuth);

/**
 * POST /twitter/content
 * Fetch content from a Twitter/X post
 */
router.post('/content', async (req: Request, res: Response) => {
  const { url, includeReplies } = req.body as TwitterContentRequest;

  if (!url || typeof url !== 'string') {
    res.status(400).json({
      success: false,
      error: 'url is required in request body',
    });
    return;
  }

  if (!isTwitterUrl(url)) {
    res.status(400).json({
      success: false,
      url,
      error: 'Invalid Twitter/X URL. Must be a tweet URL like https://x.com/user/status/123',
      errorType: 'InvalidUrl',
    });
    return;
  }

  try {
    const result = await fetchTwitterContent({
      url,
      includeReplies,
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
    logger.error('Unexpected error in Twitter fetch', { error });
    res.status(500).json({
      success: false,
      url,
      error: 'Internal server error',
      errorType: 'ServerError',
    });
  }
});

/**
 * GET /twitter/content?url=xxx
 * Alternative GET endpoint
 */
router.get('/content', async (req: Request, res: Response) => {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    res.status(400).json({
      success: false,
      error: 'url query parameter is required',
    });
    return;
  }

  if (!isTwitterUrl(url)) {
    res.status(400).json({
      success: false,
      url,
      error: 'Invalid Twitter/X URL. Must be a tweet URL like https://x.com/user/status/123',
      errorType: 'InvalidUrl',
    });
    return;
  }

  try {
    const result = await fetchTwitterContent({ url });

    if (result.success) {
      res.json(result);
    } else {
      if (result.errorType) {
        setErrorType(res, result.errorType);
      }
      res.status(getStatusCode(result.errorType)).json(result);
    }
  } catch (error) {
    logger.error('Unexpected error in Twitter fetch', { error });
    res.status(500).json({
      success: false,
      url,
      error: 'Internal server error',
      errorType: 'ServerError',
    });
  }
});

/**
 * POST /twitter/validate
 * Check if a URL is a valid Twitter URL
 */
router.post('/validate', (req: Request, res: Response) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    res.status(400).json({
      success: false,
      error: 'url is required in request body',
    });
    return;
  }

  res.json({
    valid: isTwitterUrl(url),
    url,
  });
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
