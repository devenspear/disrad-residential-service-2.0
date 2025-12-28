import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { YoutubeTranscript } from 'youtube-transcript';
import { logger } from '../utils/logger';
import { cacheGet, cacheSet, generateCacheKey } from '../utils/cache';
import type { TranscriptResult, TranscriptSegment, TranscriptErrorType } from '../types';

const execAsync = promisify(exec);
const readFileAsync = promisify(fs.readFile);
const unlinkAsync = promisify(fs.unlink);
const readdirAsync = promisify(fs.readdir);

// yt-dlp path - can be overridden via env var
const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp';

/**
 * Fetch YouTube transcript using yt-dlp CLI (primary method)
 * Falls back to youtube-transcript npm package if yt-dlp fails
 */
export async function fetchYouTubeTranscript(
  videoId: string,
  language?: string
): Promise<TranscriptResult> {
  const startTime = Date.now();
  const cacheKey = generateCacheKey('transcript', { videoId, language: language || 'en' });

  // Check cache first
  const cached = cacheGet<TranscriptResult>(cacheKey);
  if (cached) {
    logger.info(`Cache hit for video ${videoId}`);
    return {
      ...cached,
      fetchTimeMs: 0,
      source: 'cache',
      cached: true,
    };
  }

  logger.info(`Fetching transcript for video: ${videoId}`);

  // Try yt-dlp first (more reliable)
  let result = await fetchWithYtDlp(videoId, language, startTime);

  // Fall back to npm library if yt-dlp fails with retryable error
  if (!result.success && isRetryableYtDlpError(result.error)) {
    logger.info(`yt-dlp failed, trying youtube-transcript npm package`);
    result = await fetchWithNpmLibrary(videoId, language, startTime);
  }

  // Cache successful results
  if (result.success) {
    cacheSet(cacheKey, result, 'transcript');
  }

  return result;
}

/**
 * Fetch transcript using yt-dlp CLI
 */
async function fetchWithYtDlp(
  videoId: string,
  language: string | undefined,
  startTime: number
): Promise<TranscriptResult> {
  const lang = language || 'en';
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const tempDir = os.tmpdir();
  const tempBase = path.join(tempDir, `yt_${videoId}_${Date.now()}`);

  try {
    // First, check if subtitles are available
    const listCmd = `"${YT_DLP_PATH}" --list-subs --skip-download "${url}" 2>&1`;
    logger.info(`Running: ${listCmd}`);
    const { stdout: listOutput } = await execAsync(listCmd, { timeout: 60000 });

    // Check for common errors in list output
    if (listOutput.includes('Video unavailable') || listOutput.includes('Private video')) {
      return createErrorResult(videoId, 'Video not found or is private', 'VideoNotFound', startTime);
    }

    if (listOutput.includes('Sign in to confirm your age')) {
      return createErrorResult(videoId, 'Age-restricted video', 'AgeRestricted', startTime);
    }

    // Check if any subtitles exist
    const hasAutoSubs = listOutput.includes('Available automatic captions');
    const hasManualSubs = listOutput.includes('Available subtitles');

    if (!hasAutoSubs && !hasManualSubs) {
      return createErrorResult(videoId, 'No captions available for this video', 'TranscriptNotFound', startTime);
    }

    // Determine subtitle type to fetch (prefer manual over auto)
    const subType = hasManualSubs ? '--write-subs' : '--write-auto-subs';

    // Fetch subtitles as VTT format to temp file
    const fetchCmd = `"${YT_DLP_PATH}" ${subType} --sub-langs "${lang}" --sub-format vtt --skip-download -o "${tempBase}" "${url}" 2>&1`;
    logger.info(`Running: ${fetchCmd}`);

    await execAsync(fetchCmd, { timeout: 90000 });

    // Find the downloaded VTT file - yt-dlp creates files like: {output}.{lang}.vtt
    const tempBasename = path.basename(tempBase);
    const files = await readdirAsync(tempDir);
    const vttFile = files.find(f => f.startsWith(tempBasename) && f.endsWith('.vtt'));

    if (!vttFile) {
      logger.warn(`No VTT file found for ${videoId} in ${tempDir}`);
      // List what files we do have
      const matchingFiles = files.filter(f => f.includes(videoId) || f.startsWith('yt_'));
      logger.info(`Found files: ${matchingFiles.slice(0, 10).join(', ')}`);
      return createErrorResult(videoId, 'Could not download subtitles', 'TranscriptNotFound', startTime);
    }

    const vttPath = path.join(tempDir, vttFile);
    logger.info(`Found VTT file: ${vttFile}`);
    const vttContent = await readFileAsync(vttPath, 'utf-8');

    // Clean up temp file
    await unlinkAsync(vttPath).catch(() => {});

    // Parse VTT content
    const segments = parseVttSubtitles(vttContent);

    if (segments.length === 0) {
      return createErrorResult(videoId, 'No transcript content found', 'TranscriptNotFound', startTime);
    }

    const fullText = segments.map(s => s.text).join(' ').trim();
    const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;

    logger.info(`yt-dlp fetched ${wordCount} words for ${videoId}`);

    return {
      success: true,
      videoId,
      transcript: {
        fullText,
        segments,
        language: lang,
        wordCount,
      },
      source: 'yt-dlp',
      fetchTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.warn(`yt-dlp failed for ${videoId}: ${errorMessage}`);

    // Clean up any temp files
    try {
      const tempBasenameForCleanup = path.basename(tempBase);
      const files = await readdirAsync(tempDir);
      for (const f of files.filter(f => f.startsWith(tempBasenameForCleanup))) {
        await unlinkAsync(path.join(tempDir, f)).catch(() => {});
      }
    } catch { /* ignore */ }

    // Check for specific errors
    if (errorMessage.includes('command not found') || errorMessage.includes('not recognized')) {
      return createErrorResult(videoId, 'yt-dlp not installed', 'ServerError', startTime);
    }

    if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
      return createErrorResult(videoId, 'Request timed out', 'Timeout', startTime);
    }

    return createErrorResult(videoId, `yt-dlp error: ${errorMessage}`, 'Unknown', startTime);
  }
}

/**
 * Fetch transcript using youtube-transcript npm package (fallback)
 */
async function fetchWithNpmLibrary(
  videoId: string,
  language: string | undefined,
  startTime: number
): Promise<TranscriptResult> {
  try {
    const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, {
      lang: language,
    });

    if (!transcriptItems || transcriptItems.length === 0) {
      return createErrorResult(videoId, 'No transcript available', 'TranscriptNotFound', startTime);
    }

    const segments: TranscriptSegment[] = transcriptItems.map(item => ({
      start: item.offset / 1000,
      duration: item.duration / 1000,
      text: item.text,
    }));

    const fullText = segments.map(s => s.text).join(' ').trim();
    const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;

    return {
      success: true,
      videoId,
      transcript: {
        fullText,
        segments,
        language: language || 'en',
        wordCount,
      },
      source: 'youtube-transcript',
      fetchTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`npm library failed for ${videoId}: ${errorMessage}`);

    const errorType = classifyYouTubeError(errorMessage);
    return createErrorResult(videoId, errorMessage, errorType, startTime);
  }
}

/**
 * Parse JSON3 subtitle format from yt-dlp
 */
function parseJson3Subtitles(data: { events?: Array<{ segs?: Array<{ utf8: string }>; tStartMs?: number; dDurationMs?: number }> }): TranscriptSegment[] {
  if (!data.events) return [];

  const segments: TranscriptSegment[] = [];

  for (const event of data.events) {
    if (!event.segs) continue;

    const text = event.segs
      .map(seg => seg.utf8 || '')
      .join('')
      .replace(/\n/g, ' ')
      .trim();

    if (text) {
      segments.push({
        start: (event.tStartMs || 0) / 1000,
        duration: (event.dDurationMs || 0) / 1000,
        text,
      });
    }
  }

  return segments;
}

/**
 * Parse VTT subtitle format
 */
function parseVttSubtitles(vttContent: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const lines = vttContent.split('\n');

  let currentStart = 0;
  let currentEnd = 0;
  let currentText = '';

  for (const line of lines) {
    // Match timestamp line: 00:00:00.000 --> 00:00:05.000
    const timestampMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);

    if (timestampMatch) {
      // Save previous segment if exists
      if (currentText) {
        segments.push({
          start: currentStart,
          duration: currentEnd - currentStart,
          text: currentText.trim(),
        });
      }

      currentStart = parseVttTimestamp(timestampMatch[1]);
      currentEnd = parseVttTimestamp(timestampMatch[2]);
      currentText = '';
    } else if (line.trim() && !line.startsWith('WEBVTT') && !line.match(/^NOTE/)) {
      // Accumulate text (skip headers and notes)
      // Remove HTML tags and speaker labels
      const cleanText = line
        .replace(/<[^>]+>/g, '')
        .replace(/^\[.*?\]\s*/, '')
        .trim();

      if (cleanText) {
        currentText += (currentText ? ' ' : '') + cleanText;
      }
    }
  }

  // Don't forget last segment
  if (currentText) {
    segments.push({
      start: currentStart,
      duration: currentEnd - currentStart,
      text: currentText.trim(),
    });
  }

  return segments;
}

/**
 * Parse VTT timestamp to seconds
 */
function parseVttTimestamp(timestamp: string): number {
  const parts = timestamp.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseFloat(parts[2]);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Classify YouTube error into error type
 */
function classifyYouTubeError(message: string): TranscriptErrorType {
  const lower = message.toLowerCase();

  if (lower.includes('transcript is disabled') || lower.includes('subtitles are disabled')) {
    return 'TranscriptsDisabled';
  }
  if (lower.includes('no transcript') || lower.includes('no captions')) {
    return 'TranscriptNotFound';
  }
  if (lower.includes('video unavailable') || lower.includes('not found')) {
    return 'VideoNotFound';
  }
  if (lower.includes('private')) {
    return 'PrivateVideo';
  }
  if (lower.includes('age') || lower.includes('sign in')) {
    return 'AgeRestricted';
  }
  if (lower.includes('too many requests') || lower.includes('rate limit')) {
    return 'RateLimited';
  }
  if (lower.includes('timeout')) {
    return 'Timeout';
  }
  if (lower.includes('network') || lower.includes('econnrefused')) {
    return 'NetworkError';
  }

  return 'Unknown';
}

/**
 * Check if error is retryable (should try npm fallback)
 */
function isRetryableYtDlpError(error: string | undefined): boolean {
  if (!error) return true;

  const lower = error.toLowerCase();

  // Don't retry for permanent errors
  const permanentErrors = [
    'not found',
    'private',
    'unavailable',
    'disabled',
    'no captions',
    'no transcript',
    'age-restricted',
  ];

  return !permanentErrors.some(e => lower.includes(e));
}

/**
 * Create error result helper
 */
function createErrorResult(
  videoId: string,
  error: string,
  errorType: TranscriptErrorType,
  startTime: number
): TranscriptResult {
  return {
    success: false,
    videoId,
    error,
    errorType,
    fetchTimeMs: Date.now() - startTime,
  };
}

// Legacy exports for compatibility
export function clearCache(): void {
  // Cache is now managed by utils/cache.ts
  logger.info('Cache clear requested (managed by LRU cache)');
}

export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: 0,
    keys: [],
  };
}
