// ============================================================================
// SERVICE TYPES
// ============================================================================

export interface ServiceHealth {
  status: 'operational' | 'degraded' | 'down';
  version: string;
  uptime: number;
  uptimeFormatted: string;
  startedAt: string;
  system: {
    hostname: string;
    platform: string;
    arch: string;
    nodeVersion: string;
    memory: {
      free: number;
      total: number;
      usagePercent: number;
    };
    cpu: {
      model: string;
      cores: number;
    };
  };
  browser?: BrowserPoolStatus;
  cache?: CacheStats;
}

// ============================================================================
// BROWSER POOL TYPES
// ============================================================================

export interface BrowserPoolStatus {
  status: 'ready' | 'initializing' | 'error';
  version?: string;
  activeContexts: number;
  maxContexts: number;
  totalPagesCreated: number;
  lastError?: string;
}

export interface BrowserContext {
  id: string;
  createdAt: Date;
  release: () => void;
}

// ============================================================================
// CACHE TYPES
// ============================================================================

export interface CacheStats {
  size: number;
  maxSize: number;
  hitRate: number;
  hits: number;
  misses: number;
}

// ============================================================================
// TRANSCRIPT TYPES
// ============================================================================

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
  errorType?: TranscriptErrorType;
  fetchTimeMs?: number;
  source?: 'youtube-transcript' | 'yt-dlp' | 'cache';
  cached?: boolean;
}

export type TranscriptErrorType =
  | 'TranscriptNotFound'
  | 'TranscriptsDisabled'
  | 'VideoNotFound'
  | 'PrivateVideo'
  | 'AgeRestricted'
  | 'Timeout'
  | 'NetworkError'
  | 'ServerError'
  | 'RateLimited'
  | 'Unknown';

// ============================================================================
// CONTENT EXTRACTION TYPES
// ============================================================================

export interface ContentFetchRequest {
  url: string;
  contentType?: 'auto' | 'article' | 'twitter' | 'youtube';
  waitFor?: string;
  timeout?: number;
}

export interface ContentFetchResult {
  success: boolean;
  url: string;
  content?: {
    text: string;
    html?: string;
  };
  metadata?: {
    title?: string;
    author?: string;
    publishedAt?: string;
    wordCount: number;
    fetchedAt: string;
    method: 'playwright' | 'fetch' | 'cache';
    latencyMs: number;
  };
  error?: string;
  errorType?: ContentErrorType;
}

export type ContentErrorType =
  | 'Timeout'
  | 'NetworkError'
  | 'Blocked'
  | 'NotFound'
  | 'InvalidUrl'
  | 'ServerError'
  | 'Unknown';

// ============================================================================
// TWITTER TYPES
// ============================================================================

export interface TwitterContentRequest {
  url: string;
  includeReplies?: boolean;
}

export interface TwitterContentResult {
  success: boolean;
  url: string;
  content?: {
    text: string;
    authorName?: string;
    authorHandle?: string;
    timestamp?: string;
    likes?: number;
    retweets?: number;
    replies?: number;
  };
  error?: string;
  errorType?: ContentErrorType;
  fetchTimeMs?: number;
}

// ============================================================================
// METRICS TYPES
// ============================================================================

export interface RequestMetrics {
  timestamp: Date;
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  success: boolean;
  contentType?: string;
  errorType?: string;
}

export interface MetricsSummary {
  period: string;
  summary: {
    totalRequests: number;
    successRate: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  };
  byEndpoint: Record<string, EndpointMetrics>;
  byContentType: Record<string, ContentTypeMetrics>;
  errors: Record<string, number>;
  cache: CacheStats;
}

export interface EndpointMetrics {
  requests: number;
  success: number;
  failed: number;
  avgLatency: number;
}

export interface ContentTypeMetrics {
  requests: number;
  success: number;
  avgLatency: number;
}

// ============================================================================
// VERSION COMPATIBILITY
// ============================================================================

export interface VersionInfo {
  service: string;
  version: string;
  minClientVersion: string;
  apiVersion: string;
  features: string[];
}

export interface CompatibilityCheck {
  compatible: boolean;
  serviceVersion: string;
  clientVersion: string;
  warnings?: string[];
}
