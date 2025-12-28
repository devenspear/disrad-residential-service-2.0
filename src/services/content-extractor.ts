import { Page } from 'playwright';
import { browserPool } from './browser-pool';
import { logger } from '../utils/logger';
import { cacheGet, cacheSet, generateCacheKey } from '../utils/cache';
import { config } from '../config';
import type { ContentFetchRequest, ContentFetchResult, ContentErrorType } from '../types';

/**
 * Extract content from any webpage using Playwright
 */
export async function fetchContent(request: ContentFetchRequest): Promise<ContentFetchResult> {
  const startTime = Date.now();
  const { url, waitFor, timeout = config.browserPageTimeoutMs } = request;

  // Validate URL
  try {
    new URL(url);
  } catch {
    return {
      success: false,
      url,
      error: 'Invalid URL format',
      errorType: 'InvalidUrl',
    };
  }

  // Check cache
  const cacheKey = generateCacheKey('content', { url });
  const cached = cacheGet<ContentFetchResult>(cacheKey);
  if (cached) {
    return {
      ...cached,
      metadata: {
        ...cached.metadata!,
        method: 'cache',
        latencyMs: Date.now() - startTime,
      },
    };
  }

  let context;
  let page: Page | null = null;

  try {
    // Acquire browser context
    context = await browserPool.acquireContext();
    page = await browserPool.createPage(context.context);

    logger.info(`Fetching content from: ${url}`);

    // Navigate to URL
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout,
    });

    // Wait for specific element if requested
    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: timeout / 2 });
    }

    // Extract content
    const content = await page.evaluate(() => {
      // Remove script/style elements
      const scripts = document.querySelectorAll('script, style, noscript, iframe');
      scripts.forEach(el => el.remove());

      // Try to find main content area
      const mainSelectors = [
        'article',
        '[role="main"]',
        'main',
        '.post-content',
        '.article-content',
        '.entry-content',
        '.content',
        '#content',
      ];

      let mainElement: Element | null = null;
      for (const selector of mainSelectors) {
        mainElement = document.querySelector(selector);
        if (mainElement) break;
      }

      const textSource = mainElement || document.body;
      const text = textSource.textContent?.trim().replace(/\s+/g, ' ') || '';

      return {
        text,
        html: textSource.innerHTML,
      };
    });

    // Extract metadata
    const metadata = await page.evaluate(() => {
      const getMetaContent = (name: string): string | undefined => {
        const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
        return meta?.getAttribute('content') || undefined;
      };

      return {
        title: document.title || undefined,
        author: getMetaContent('author') || getMetaContent('article:author'),
        publishedAt: getMetaContent('article:published_time') || getMetaContent('publishedDate'),
      };
    });

    const wordCount = content.text.split(/\s+/).filter(w => w.length > 0).length;

    const result: ContentFetchResult = {
      success: true,
      url,
      content,
      metadata: {
        ...metadata,
        wordCount,
        fetchedAt: new Date().toISOString(),
        method: 'playwright',
        latencyMs: Date.now() - startTime,
      },
    };

    // Cache successful result
    cacheSet(cacheKey, result, 'content');

    logger.info(`Content fetched: ${wordCount} words in ${result.metadata!.latencyMs}ms`);
    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorType = classifyError(errorMessage);

    logger.error(`Failed to fetch content from ${url}: ${errorMessage}`);

    return {
      success: false,
      url,
      error: errorMessage,
      errorType,
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
 * Check if URL is likely to need Playwright
 */
export function needsPlaywright(url: string): boolean {
  const patterns = [
    /twitter\.com/i,
    /x\.com/i,
    /substack\.com/i,
    /medium\.com/i,
    /notion\.so/i,
    /linkedin\.com/i,
  ];

  return patterns.some(pattern => pattern.test(url));
}
