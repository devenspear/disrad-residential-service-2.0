import { Page } from 'playwright';
import { browserPool } from './browser-pool';
import { logger } from '../utils/logger';
import { cacheGet, cacheSet, generateCacheKey } from '../utils/cache';
import { config } from '../config';
import type { ContentFetchRequest, ContentFetchResult, ContentErrorType } from '../types';

// Site-specific content selectors for better extraction
const SITE_SELECTORS: Record<string, { content: string[]; waitFor?: string; scrollPage?: boolean }> = {
  // Substack
  'substack.com': {
    content: ['.post-content', '.body', 'article', '.markup'],
    waitFor: '.post-content, .body',
  },
  // Medium
  'medium.com': {
    content: ['article', '.meteredContent', '.pw-post-body-paragraph'],
    waitFor: 'article',
    scrollPage: true,
  },
  // LinkedIn
  'linkedin.com': {
    content: ['.article-content', '.feed-shared-update-v2__description', '.share-article__description'],
    waitFor: '.article-content, .feed-shared-update-v2',
    scrollPage: true,
  },
  // YouTube (community posts / video descriptions)
  'youtube.com': {
    content: ['#content', 'ytd-text-inline-expander', '#description-inline-expander'],
    waitFor: '#content',
  },
  // Notion
  'notion.so': {
    content: ['.notion-page-content', '.notion-selectable'],
    waitFor: '.notion-page-content',
  },
  // Generic news sites
  'default': {
    content: [
      'article',
      '[role="main"]',
      'main',
      '.post-content',
      '.article-content',
      '.article-body',
      '.entry-content',
      '.story-body',
      '.post-body',
      '.content-body',
      '.article__body',
      '[itemprop="articleBody"]',
      '.wysiwyg',
      '.prose',
      '#article-body',
      '#main-content',
      '.main-content',
      '.content',
      '#content',
    ],
  },
};

/**
 * Get site-specific configuration
 */
function getSiteConfig(url: string): typeof SITE_SELECTORS[string] {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');

    // Check for exact matches first
    for (const [site, config] of Object.entries(SITE_SELECTORS)) {
      if (site !== 'default' && hostname.includes(site)) {
        return config;
      }
    }

    return SITE_SELECTORS['default'];
  } catch {
    return SITE_SELECTORS['default'];
  }
}

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

  const siteConfig = getSiteConfig(url);
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

    // Wait for specific element if provided, otherwise use site config
    const waitSelector = waitFor || siteConfig.waitFor;
    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: timeout / 2 }).catch(() => {
        logger.warn(`Could not find wait selector: ${waitSelector}`);
      });
    }

    // Some sites need scrolling to load lazy content
    if (siteConfig.scrollPage) {
      await autoScroll(page);
    }

    // Extra wait for dynamic content
    await page.waitForTimeout(1500);

    // Extract content with improved selectors
    const content = await page.evaluate((selectors: string[]) => {
      // Remove unwanted elements
      const unwanted = document.querySelectorAll(
        'script, style, noscript, iframe, nav, header, footer, ' +
        '.sidebar, .comments, .related-posts, .advertisement, .ad, ' +
        '[role="navigation"], [role="banner"], [role="complementary"], ' +
        '.share-buttons, .social-share, .newsletter-signup, .cookie-banner'
      );
      unwanted.forEach(el => el.remove());

      // Try selectors in order of preference
      let mainElement: Element | null = null;
      for (const selector of selectors) {
        mainElement = document.querySelector(selector);
        if (mainElement && mainElement.textContent && mainElement.textContent.trim().length > 100) {
          break;
        }
      }

      // Fall back to body if no good match
      const textSource = mainElement || document.body;

      // Clean up text: normalize whitespace, remove excess newlines
      const rawText = textSource.textContent || '';
      const text = rawText
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();

      return {
        text,
        html: textSource.innerHTML,
      };
    }, siteConfig.content);

    // Extract metadata
    const metadata = await page.evaluate(() => {
      const getMetaContent = (names: string[]): string | undefined => {
        for (const name of names) {
          const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
          const content = meta?.getAttribute('content');
          if (content) return content;
        }
        return undefined;
      };

      return {
        title: document.title || getMetaContent(['og:title', 'twitter:title']) || undefined,
        author: getMetaContent(['author', 'article:author', 'twitter:creator', 'dc.creator']),
        publishedAt: getMetaContent(['article:published_time', 'publishedDate', 'datePublished', 'og:published_time']),
        description: getMetaContent(['description', 'og:description', 'twitter:description']),
      };
    });

    const wordCount = content.text.split(/\s+/).filter(w => w.length > 0).length;

    // Check if we got meaningful content
    if (wordCount < 20) {
      logger.warn(`Low word count (${wordCount}) for ${url}, content may be incomplete`);
    }

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

    // Cache successful result (only if we got meaningful content)
    if (wordCount >= 20) {
      cacheSet(cacheKey, result, 'content');
    }

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
 * Auto-scroll page to trigger lazy loading
 */
async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const maxScrolls = 10;
      let scrollCount = 0;

      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        scrollCount++;

        if (totalHeight >= scrollHeight || scrollCount >= maxScrolls) {
          clearInterval(timer);
          window.scrollTo(0, 0); // Scroll back to top
          resolve();
        }
      }, 100);
    });
  });
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
