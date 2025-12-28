import { Router, Request, Response } from 'express';
import { fetchYouTubeTranscript, clearCache, getCacheStats } from '../services/youtube';
import { apiKeyAuth } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

// All transcript routes require API key
router.use(apiKeyAuth);

// GET /transcript?videoId=xxx&language=en
router.get('/', async (req: Request, res: Response) => {
  const { videoId, language } = req.query;

  if (!videoId || typeof videoId !== 'string') {
    res.status(400).json({
      success: false,
      error: 'videoId query parameter is required',
    });
    return;
  }

  // Validate videoId format (YouTube video IDs are 11 characters)
  const cleanVideoId = extractVideoId(videoId);
  if (!cleanVideoId) {
    res.status(400).json({
      success: false,
      error: 'Invalid videoId format',
    });
    return;
  }

  try {
    const result = await fetchYouTubeTranscript(
      cleanVideoId,
      typeof language === 'string' ? language : undefined
    );

    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    logger.error('Unexpected error in transcript route', { error });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

// POST /transcript/batch - Fetch multiple transcripts
router.post('/batch', async (req: Request, res: Response) => {
  const { videoIds, language } = req.body;

  if (!Array.isArray(videoIds) || videoIds.length === 0) {
    res.status(400).json({
      success: false,
      error: 'videoIds array is required',
    });
    return;
  }

  if (videoIds.length > 10) {
    res.status(400).json({
      success: false,
      error: 'Maximum 10 videos per batch request',
    });
    return;
  }

  const results = await Promise.all(
    videoIds.map((id: string) => {
      const cleanId = extractVideoId(id);
      if (!cleanId) {
        return Promise.resolve({
          success: false,
          videoId: id,
          error: 'Invalid videoId format',
        });
      }
      return fetchYouTubeTranscript(cleanId, language);
    })
  );

  res.json({
    success: true,
    results,
    summary: {
      total: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    },
  });
});

// GET /transcript/cache - Get cache stats (admin)
router.get('/cache', (_req: Request, res: Response) => {
  res.json(getCacheStats());
});

// DELETE /transcript/cache - Clear cache (admin)
router.delete('/cache', (_req: Request, res: Response) => {
  clearCache();
  res.json({ success: true, message: 'Cache cleared' });
});

// Helper: Extract video ID from various formats
function extractVideoId(input: string): string | null {
  // Already a video ID (11 characters)
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return input;
  }

  // Full YouTube URL
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

export default router;
