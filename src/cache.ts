import moment from "moment";

interface CacheItem<T> {
    expire: number;
    item: T;
    key: string;
}

interface Result { code: number, msg: string }
interface ICacheContainer<T> {
    Get(key: string): CacheItem<T> | undefined;
    SetVal(key: string, val: T, expire: number): Result;
    SetCahceItem(key: string, val: CacheItem<T>): Result;
    PeekAll(): Map<string, T>;
    Range(fn: (key: string, val: CacheItem<T>) => Result): void;
    OnEmit(item: CacheItem<T>): void;
}

class BaseCache<T> implements ICacheContainer<T> {
    cache: Map<string, CacheItem<T>>

    constructor() {
        this.cache = new Map<string, CacheItem<T>>
    }

    Get(key: string): CacheItem<T> | undefined {
        let item = this.cache.get(key)
        if (!item) {
            return undefined;
        }

        let now = moment.now();
        if (item.expire > now) {
            return item
        } else {
            this.OnEmit(item);
            this.cache.delete(item.key);
            return undefined;
        }
    }

    SetVal(key: string, val: T, expire: number): Result {
        let item: CacheItem<T> = {
            key: key,
            expire: expire,
            item: val,
        }
        return this.SetCahceItem(key, item)
    }
    SetCahceItem(key: string, val: CacheItem<T>): Result {
        this.cache.set(key, val)
        return {
            code: 0,
            msg: "",
        }
    }

    PeekAll(): Map<string, T> {
        let res = new Map<string, T>();
        let now = moment.now();
        this.cache.forEach((item) => {
            if (item.expire > now) {
                res.set(item.key, item.item)
            } else {
                this.cache.delete(item.key);
                this.OnEmit(item);
            }
        });
        return res
    }
    Range(fn: (key: string, val: CacheItem<T>) => Result): void {
        try {
            let now = moment.now();
            this.cache.forEach((item) => {
                if (item.expire > now) {
                    fn(item.key, item);
                } else {
                    this.cache.delete(item.key);
                    this.OnEmit(item);
                }
            });
        } catch (err) {
            console.error(err);
        }
    }

    OnEmit(item: CacheItem<T>): void {
    }
}


class LRUCache<T> extends BaseCache<T> {
    // list
}
