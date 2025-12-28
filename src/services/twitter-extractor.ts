import { Page } from 'playwright';
import { browserPool } from './browser-pool';
import { logger } from '../utils/logger';
import { cacheGet, cacheSet, generateCacheKey } from '../utils/cache';
import { config } from '../config';
import type { TwitterContentRequest, TwitterContentResult, ContentErrorType } from '../types';

// Public Nitter instances (fallback options)
const NITTER_INSTANCES = [
  'nitter.privacydev.net',
  'nitter.poast.org',
  'nitter.woodland.cafe',
  'nitter.kavin.rocks',
];

/**
 * Extract content from Twitter/X posts
 * Uses Nitter as primary method (doesn't require login),
 * falls back to direct Twitter if Nitter fails
 */
export async function fetchTwitterContent(request: TwitterContentRequest): Promise<TwitterContentResult> {
  const startTime = Date.now();
  const { url } = request;

  // Validate and normalize URL
  const tweetInfo = parseTwitterUrl(url);
  if (!tweetInfo) {
    return {
      success: false,
      url,
      error: 'Invalid Twitter/X URL',
      errorType: 'InvalidUrl',
    };
  }

  // Check cache
  const cacheKey = generateCacheKey('twitter', { url: tweetInfo.normalizedUrl });
  const cached = cacheGet<TwitterContentResult>(cacheKey);
  if (cached) {
    return {
      ...cached,
      fetchTimeMs: Date.now() - startTime,
    };
  }

  logger.info(`Fetching Twitter content for: ${tweetInfo.normalizedUrl}`);

  // Try Nitter instances first (doesn't require login)
  for (const nitterHost of NITTER_INSTANCES) {
    const nitterUrl = `https://${nitterHost}/${tweetInfo.username}/status/${tweetInfo.statusId}`;
    const result = await fetchFromNitter(nitterUrl, url, startTime);

    if (result.success) {
      // Cache successful result
      cacheSet(cacheKey, result, 'twitter');
      logger.info(`Twitter content fetched via Nitter (${nitterHost}) in ${result.fetchTimeMs}ms`);
      return result;
    }

    logger.warn(`Nitter instance ${nitterHost} failed: ${result.error}`);
  }

  // Fall back to direct Twitter/X (may require login)
  logger.info('All Nitter instances failed, trying direct Twitter');
  const directResult = await fetchFromTwitterDirect(tweetInfo.normalizedUrl, url, startTime);

  if (directResult.success) {
    cacheSet(cacheKey, directResult, 'twitter');
  }

  return directResult;
}

/**
 * Fetch tweet from Nitter instance
 */
async function fetchFromNitter(
  nitterUrl: string,
  originalUrl: string,
  startTime: number
): Promise<TwitterContentResult> {
  let context;
  let page: Page | null = null;

  try {
    context = await browserPool.acquireContext();
    page = await browserPool.createPage(context.context);

    await page.goto(nitterUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // Wait for tweet content
    await page.waitForSelector('.main-tweet, .timeline-item', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Extract content from Nitter
    const content = await page.evaluate(() => {
      // Main tweet container
      const mainTweet = document.querySelector('.main-tweet') ||
                        document.querySelector('.timeline-item');

      if (!mainTweet) return null;

      // Tweet text
      const tweetTextEl = mainTweet.querySelector('.tweet-content');
      const text = tweetTextEl?.textContent?.trim() || '';

      // Author info
      const fullnameEl = mainTweet.querySelector('.fullname');
      const usernameEl = mainTweet.querySelector('.username');
      const authorName = fullnameEl?.textContent?.trim();
      const authorHandle = usernameEl?.textContent?.replace('@', '').trim();

      // Timestamp
      const dateEl = mainTweet.querySelector('.tweet-date a');
      const timestamp = dateEl?.getAttribute('title') || undefined;

      // Engagement stats
      const statsEl = mainTweet.querySelector('.tweet-stats');
      const parseCount = (selector: string): number | undefined => {
        const el = statsEl?.querySelector(selector);
        if (!el) return undefined;
        const text = el.textContent || '';
        const match = text.match(/[\d,]+/);
        return match ? parseInt(match[0].replace(/,/g, '')) : undefined;
      };

      return {
        text,
        authorName,
        authorHandle,
        timestamp,
        likes: parseCount('.icon-heart + .tweet-stat-count, .icon-heart ~ span'),
        retweets: parseCount('.icon-retweet + .tweet-stat-count, .icon-retweet ~ span'),
        replies: parseCount('.icon-comment + .tweet-stat-count, .icon-comment ~ span'),
      };
    });

    if (!content || !content.text) {
      return {
        success: false,
        url: originalUrl,
        error: 'Could not extract tweet content from Nitter',
        errorType: 'NotFound',
        fetchTimeMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      url: originalUrl,
      content,
      fetchTimeMs: Date.now() - startTime,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      url: originalUrl,
      error: `Nitter error: ${errorMessage}`,
      errorType: classifyError(errorMessage),
      fetchTimeMs: Date.now() - startTime,
    };
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
    if (context) {
      context.release();
    }
  }
}

/**
 * Fetch tweet directly from Twitter/X (fallback)
 */
async function fetchFromTwitterDirect(
  twitterUrl: string,
  originalUrl: string,
  startTime: number
): Promise<TwitterContentResult> {
  let context;
  let page: Page | null = null;

  try {
    context = await browserPool.acquireContext();
    page = await browserPool.createPage(context.context);

    await page.goto(twitterUrl, {
      waitUntil: 'networkidle',
      timeout: config.browserPageTimeoutMs,
    });

    // Wait for tweet content to load
    await page.waitForSelector('[data-testid="tweetText"], article', {
      timeout: 15000,
    }).catch(() => {
      logger.warn('Could not find tweet text selector');
    });

    await page.waitForTimeout(2000);

    // Check if login is required
    const loginRequired = await page.evaluate(() => {
      return document.body.textContent?.includes('Sign in to X') ||
             document.body.textContent?.includes('Log in to Twitter') ||
             document.body.textContent?.includes('Sign up now') ||
             document.querySelector('[data-testid="LoginForm"]') !== null;
    });

    if (loginRequired) {
      return {
        success: false,
        url: originalUrl,
        error: 'Twitter requires login to view this content',
        errorType: 'Blocked',
        fetchTimeMs: Date.now() - startTime,
      };
    }

    // Extract tweet content
    const content = await page.evaluate(() => {
      const tweetArticle = document.querySelector('article[data-testid="tweet"]') ||
                          document.querySelector('article');

      if (!tweetArticle) return null;

      const tweetTextElement = tweetArticle.querySelector('[data-testid="tweetText"]');
      const text = tweetTextElement?.textContent?.trim() || '';

      const authorLink = tweetArticle.querySelector('a[href*="/"]');
      const authorHandle = authorLink?.getAttribute('href')?.split('/')[1];

      const displayNameElement = tweetArticle.querySelector('[data-testid="User-Name"]');
      const authorName = displayNameElement?.textContent?.split('@')[0]?.trim();

      const timeElement = tweetArticle.querySelector('time');
      const timestamp = timeElement?.getAttribute('datetime') || undefined;

      const parseEngagement = (text: string | null): number | undefined => {
        if (!text) return undefined;
        const num = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (text.includes('K')) return num * 1000;
        if (text.includes('M')) return num * 1000000;
        return num || undefined;
      };

      const likesEl = tweetArticle.querySelector('[data-testid="like"] span');
      const retweetsEl = tweetArticle.querySelector('[data-testid="retweet"] span');
      const repliesEl = tweetArticle.querySelector('[data-testid="reply"] span');

      return {
        text,
        authorName,
        authorHandle,
        timestamp,
        likes: parseEngagement(likesEl?.textContent || null),
        retweets: parseEngagement(retweetsEl?.textContent || null),
        replies: parseEngagement(repliesEl?.textContent || null),
      };
    });

    if (!content || !content.text) {
      return {
        success: false,
        url: originalUrl,
        error: 'Could not extract tweet content',
        errorType: 'NotFound',
        fetchTimeMs: Date.now() - startTime,
      };
    }

    return {
      success: true,
      url: originalUrl,
      content,
      fetchTimeMs: Date.now() - startTime,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      url: originalUrl,
      error: errorMessage,
      errorType: classifyError(errorMessage),
      fetchTimeMs: Date.now() - startTime,
    };
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
    if (context) {
      context.release();
    }
  }
}

/**
 * Parse Twitter URL and extract components
 */
function parseTwitterUrl(url: string): { username: string; statusId: string; normalizedUrl: string } | null {
  try {
    const parsed = new URL(url);

    // Must be Twitter or X domain
    const validHosts = ['twitter.com', 'x.com', 'www.twitter.com', 'www.x.com', 'mobile.twitter.com', 'mobile.x.com'];
    if (!validHosts.includes(parsed.hostname)) {
      return null;
    }

    // Extract status ID from path like /user/status/123456
    const statusMatch = parsed.pathname.match(/\/([^/]+)\/status\/(\d+)/);
    if (!statusMatch) {
      return null;
    }

    return {
      username: statusMatch[1],
      statusId: statusMatch[2],
      normalizedUrl: `https://x.com/${statusMatch[1]}/status/${statusMatch[2]}`,
    };
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
  return parseTwitterUrl(url) !== null;
}
