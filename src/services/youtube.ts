import { YoutubeTranscript } from 'youtube-transcript';
import { logger } from '../utils/logger';

export interface TranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

export interface TranscriptResult {
  success: boolean;
  videoId: string;
  transcript?: {
    fullText: string;
    segments: TranscriptSegment[];
    language: string;
    wordCount: number;
  };
  error?: string;
  fetchTimeMs?: number;
}

// Simple in-memory cache
const cache = new Map<string, { result: TranscriptResult; timestamp: number }>();
const CACHE_TTL = parseInt(process.env.CACHE_TTL_SECONDS || '3600') * 1000;

export async function fetchYouTubeTranscript(
  videoId: string,
  language?: string
): Promise<TranscriptResult> {
  const startTime = Date.now();
  const cacheKey = `${videoId}-${language || 'default'}`;

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.info(`Cache hit for video ${videoId}`);
    return { ...cached.result, fetchTimeMs: 0 };
  }

  try {
    logger.info(`Fetching transcript for video: ${videoId}`);

    // Fetch transcript
    const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, {
      lang: language,
    });

    if (!transcriptItems || transcriptItems.length === 0) {
      return {
        success: false,
        videoId,
        error: 'No transcript available for this video',
        fetchTimeMs: Date.now() - startTime,
      };
    }

    // Format segments
    const segments: TranscriptSegment[] = transcriptItems.map((item) => ({
      start: item.offset / 1000, // Convert ms to seconds
      duration: item.duration / 1000,
      text: item.text,
    }));

    // Build full text
    const fullText = segments.map((s) => s.text).join(' ');
    const wordCount = fullText.split(/\s+/).filter((w) => w.length > 0).length;

    const result: TranscriptResult = {
      success: true,
      videoId,
      transcript: {
        fullText,
        segments,
        language: language || 'en',
        wordCount,
      },
      fetchTimeMs: Date.now() - startTime,
    };

    // Cache result
    cache.set(cacheKey, { result, timestamp: Date.now() });

    logger.info(`Transcript fetched: ${wordCount} words in ${result.fetchTimeMs}ms`);
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error(`Failed to fetch transcript for ${videoId}: ${errorMessage}`);

    // Parse common YouTube errors
    let friendlyError = errorMessage;
    if (errorMessage.includes('Transcript is disabled')) {
      friendlyError = 'Transcripts are disabled for this video';
    } else if (errorMessage.includes('Video unavailable')) {
      friendlyError = 'Video not found or is private';
    } else if (errorMessage.includes('Too Many Requests')) {
      friendlyError = 'Rate limited by YouTube - please wait';
    }

    return {
      success: false,
      videoId,
      error: friendlyError,
      fetchTimeMs: Date.now() - startTime,
    };
  }
}

// Cache management
export function clearCache(): void {
  cache.clear();
  logger.info('Cache cleared');
}

export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: cache.size,
    keys: Array.from(cache.keys()),
  };
}
