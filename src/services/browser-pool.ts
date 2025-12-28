import { chromium, Browser, BrowserContext as PlaywrightContext, Page } from 'playwright';
import { logger } from '../utils/logger';
import { config } from '../config';
import type { BrowserPoolStatus } from '../types';

interface ManagedContext {
  id: string;
  context: PlaywrightContext;
  createdAt: Date;
  inUse: boolean;
}

class BrowserPool {
  private browser: Browser | null = null;
  private contexts: Map<string, ManagedContext> = new Map();
  private initPromise: Promise<void> | null = null;
  private totalPagesCreated = 0;
  private lastError: string | undefined;
  private browserVersion: string | undefined;

  async initialize(): Promise<void> {
    if (this.browser) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._init();
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    try {
      logger.info('Initializing browser pool...');

      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-setuid-sandbox',
          '--no-sandbox',
          '--disable-web-security',
        ],
      });

      this.browserVersion = this.browser.version();
      logger.info(`Browser pool initialized: Chromium ${this.browserVersion}`);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to initialize browser pool', { error: this.lastError });
      throw error;
    }
  }

  async acquireContext(timeoutMs: number = config.browserContextTimeoutMs): Promise<{
    context: PlaywrightContext;
    release: () => void;
    id: string;
  }> {
    await this.initialize();

    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    // Check if we're at max capacity
    const activeCount = Array.from(this.contexts.values()).filter(c => c.inUse).length;

    if (activeCount >= config.browserMaxContexts) {
      // Wait for a context to become available
      const startWait = Date.now();

      while (Date.now() - startWait < timeoutMs) {
        const available = Array.from(this.contexts.values()).find(c => !c.inUse);
        if (available) {
          available.inUse = true;
          return {
            context: available.context,
            release: () => this.releaseContext(available.id),
            id: available.id,
          };
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      throw new Error(`Timeout waiting for browser context (${timeoutMs}ms)`);
    }

    // Create new context
    const id = `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const managed: ManagedContext = {
      id,
      context,
      createdAt: new Date(),
      inUse: true,
    };

    this.contexts.set(id, managed);
    logger.debug(`Created browser context: ${id}`);

    return {
      context,
      release: () => this.releaseContext(id),
      id,
    };
  }

  private releaseContext(id: string): void {
    const managed = this.contexts.get(id);
    if (managed) {
      managed.inUse = false;
      logger.debug(`Released browser context: ${id}`);
    }
  }

  async createPage(context: PlaywrightContext): Promise<Page> {
    const page = await context.newPage();
    this.totalPagesCreated++;

    // Set default timeout
    page.setDefaultTimeout(config.browserPageTimeoutMs);

    return page;
  }

  getStatus(): BrowserPoolStatus {
    const activeContexts = Array.from(this.contexts.values()).filter(c => c.inUse).length;

    return {
      status: this.browser ? 'ready' : (this.initPromise ? 'initializing' : 'error'),
      version: this.browserVersion,
      activeContexts,
      maxContexts: config.browserMaxContexts,
      totalPagesCreated: this.totalPagesCreated,
      lastError: this.lastError,
    };
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up browser pool...');

    // Close all contexts
    for (const [id, managed] of this.contexts) {
      try {
        await managed.context.close();
        logger.debug(`Closed context: ${id}`);
      } catch (error) {
        logger.warn(`Failed to close context ${id}`, { error });
      }
    }
    this.contexts.clear();

    // Close browser
    if (this.browser) {
      try {
        await this.browser.close();
        logger.info('Browser closed');
      } catch (error) {
        logger.warn('Failed to close browser', { error });
      }
      this.browser = null;
    }

    this.initPromise = null;
  }

  async warmup(): Promise<void> {
    await this.initialize();
    logger.info('Browser pool warmed up');
  }
}

// Singleton instance
export const browserPool = new BrowserPool();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await browserPool.cleanup();
});

process.on('SIGINT', async () => {
  await browserPool.cleanup();
});
