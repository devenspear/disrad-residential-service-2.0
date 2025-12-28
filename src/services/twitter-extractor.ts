import { Page } from 'playwright';
import { browserPool } from './browser-pool';
import { logger } from '../utils/logger';
import { cacheGet, cacheSet, generateCacheKey } from '../utils/cache';
import { config } from '../config';
import type { TwitterContentRequest, TwitterContentResult, ContentErrorType } from '../types';

/**
 * Extract content from Twitter/X posts
 */
export async function fetchTwitterContent(request: TwitterContentRequest): Promise<TwitterContentResult> {
  const startTime = Date.now();
  const { url } = request;

  // Validate and normalize URL
  const normalizedUrl = normalizeTwitterUrl(url);
  if (!normalizedUrl) {
    return {
      success: false,
      url,
      error: 'Invalid Twitter/X URL',
      errorType: 'InvalidUrl',
    };
  }

  // Check cache
  const cacheKey = generateCacheKey('twitter', { url: normalizedUrl });
  const cached = cacheGet<TwitterContentResult>(cacheKey);
  if (cached) {
    return {
      ...cached,
      fetchTimeMs: Date.now() - startTime,
    };
  }

  let context;
  let page: Page | null = null;

  try {
    // Acquire browser context
    context = await browserPool.acquireContext();
    page = await browserPool.createPage(context.context);

    logger.info(`Fetching Twitter content from: ${normalizedUrl}`);

    // Navigate to tweet
    await page.goto(normalizedUrl, {
      waitUntil: 'networkidle',
      timeout: config.browserPageTimeoutMs,
    });

    // Wait for tweet content to load
    await page.waitForSelector('[data-testid="tweetText"], article', {
      timeout: 15000,
    }).catch(() => {
      logger.warn('Could not find tweet text selector, trying alternative approach');
    });

    // Extra wait for dynamic content
    await page.waitForTimeout(2000);

    // Extract tweet content
    const content = await page.evaluate(() => {
      // Find the main tweet container
      const tweetArticle = document.querySelector('article[data-testid="tweet"]') ||
                          document.querySelector('article');

      if (!tweetArticle) {
        return null;
      }

      // Get tweet text
      const tweetTextElement = tweetArticle.querySelector('[data-testid="tweetText"]');
      const text = tweetTextElement?.textContent?.trim() || '';

      // Get author info
      const authorLink = tweetArticle.querySelector('a[href*="/"]');
      const authorHandle = authorLink?.getAttribute('href')?.split('/')[1];

      const displayNameElement = tweetArticle.querySelector('[data-testid="User-Name"]');
      const authorName = displayNameElement?.textContent?.split('@')[0]?.trim();

      // Get timestamp
      const timeElement = tweetArticle.querySelector('time');
      const timestamp = timeElement?.getAttribute('datetime') || undefined;

      // Get engagement metrics (may not always be available)
      const likesElement = tweetArticle.querySelector('[data-testid="like"] span');
      const retweetsElement = tweetArticle.querySelector('[data-testid="retweet"] span');
      const repliesElement = tweetArticle.querySelector('[data-testid="reply"] span');

      const parseEngagement = (text: string | null): number | undefined => {
        if (!text) return undefined;
        const num = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (text.includes('K')) return num * 1000;
        if (text.includes('M')) return num * 1000000;
        return num || undefined;
      };

      return {
        text,
        authorName,
        authorHandle,
        timestamp,
        likes: parseEngagement(likesElement?.textContent || null),
        retweets: parseEngagement(retweetsElement?.textContent || null),
        replies: parseEngagement(repliesElement?.textContent || null),
      };
    });

    if (!content || !content.text) {
      return {
        success: false,
        url,
        error: 'Could not extract tweet content',
        errorType: 'NotFound',
        fetchTimeMs: Date.now() - startTime,
      };
    }

    const result: TwitterContentResult = {
      success: true,
      url,
      content,
      fetchTimeMs: Date.now() - startTime,
    };

    // Cache successful result
    cacheSet(cacheKey, result, 'twitter');

    logger.info(`Twitter content fetched in ${result.fetchTimeMs}ms`);
    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorType = classifyError(errorMessage);

    logger.error(`Failed to fetch Twitter content from ${url}: ${errorMessage}`);

    return {
      success: false,
      url,
      error: errorMessage,
      errorType,
      fetchTimeMs: Date.now() - startTime,
    };
  } finally {
    // Clean up
    if (page) {
      try {
        await page.close();
      } catch {
        // Ignore close errors
      }
    }
    if (context) {
      context.release();
    }
  }
}

/**
 * Normalize Twitter URL (handle twitter.com and x.com)
 */
function normalizeTwitterUrl(url: string): string | null {
  try {
    const parsed = new URL(url);

    // Must be Twitter or X domain
    if (!['twitter.com', 'x.com', 'www.twitter.com', 'www.x.com', 'mobile.twitter.com', 'mobile.x.com'].includes(parsed.hostname)) {
      return null;
    }

    // Extract status ID from path like /user/status/123456
    const statusMatch = parsed.pathname.match(/\/([^/]+)\/status\/(\d+)/);
    if (!statusMatch) {
      return null;
    }

    // Return normalized X.com URL (they redirect from twitter.com anyway)
    return `https://x.com/${statusMatch[1]}/status/${statusMatch[2]}`;
  } catch {
    return null;
  }
}

/**
 * Classify error into error type
 */
function classifyError(message: string): ContentErrorType {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('timeout')) return 'Timeout';
  if (lowerMessage.includes('net::') || lowerMessage.includes('network')) return 'NetworkError';
  if (lowerMessage.includes('blocked') || lowerMessage.includes('403')) return 'Blocked';
  if (lowerMessage.includes('404') || lowerMessage.includes('not found')) return 'NotFound';
  if (lowerMessage.includes('500') || lowerMessage.includes('502') || lowerMessage.includes('503')) return 'ServerError';

  return 'Unknown';
}

/**
 * Check if URL is a valid Twitter URL
 */
export function isTwitterUrl(url: string): boolean {
  return normalizeTwitterUrl(url) !== null;
}
