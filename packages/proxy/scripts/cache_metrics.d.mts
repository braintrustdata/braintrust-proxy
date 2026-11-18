export interface CacheMetricDefinition {
  ttl: string;
  metric: string;
  rate_key: string;
}

export interface CacheMetricGroup {
  id: string;
  metrics: CacheMetricDefinition[];
}

export interface CacheMetric {
  index: number;
  group: number;
  ttl: string;
  metric: string;
  rate: string;
}

export interface CacheMetrics {
  groups: CacheMetricGroup[];
  metrics: CacheMetric[];
}

export function parseCacheMetricGroups(groups: unknown): CacheMetrics;
export function loadCacheMetrics(): CacheMetrics;
export function renderPricingSchema(registry: CacheMetrics): string;
export function renderCacheMetrics(registry: CacheMetrics): string;
