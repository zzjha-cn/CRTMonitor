import moment from "moment";

export interface CacheItem<T> {
    expire: number;
    item: T;
    key: string;
}

export class MemoryCache<T> {
    private cache: Map<string, CacheItem<T>>;
    private cleanupInterval: NodeJS.Timeout;

    constructor(cleanupIntervalMs: number = 60000) {
        this.cache = new Map<string, CacheItem<T>>();
        // 定期清理过期缓存
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, cleanupIntervalMs);
    }

    set(key: string, value: T, ttlMs: number): void {
        const expire = Date.now() + ttlMs;
        this.cache.set(key, {
            key,
            item: value,
            expire
        });
    }

    get(key: string): T | undefined {
        const item = this.cache.get(key);
        if (!item) {
            return undefined;
        }

        if (Date.now() > item.expire) {
            this.cache.delete(key);
            return undefined;
        }

        return item.item;
    }

    has(key: string): boolean {
        return this.get(key) !== undefined;
    }

    delete(key: string): void {
        this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
    }

    cleanup(): void {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (now > item.expire) {
                this.cache.delete(key);
            }
        }
    }

    destroy(): void {
        clearInterval(this.cleanupInterval);
        this.cache.clear();
    }

    getStats() {
        return {
            size: this.cache.size
        };
    }
}

export const GlobalCache = new MemoryCache<any>();
