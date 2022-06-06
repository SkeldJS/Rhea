import ioredis from "ioredis";
import { RedisChannels } from "../types";

export interface CachedData {
    expiresAt: number;
    data: any;
}

export class Cache {
    private cache: Map<any, CachedData>;

    constructor(private readonly redisConnection?: ioredis.Redis) {
        this.cache = new Map;
    }

    setCached(key: any, value: any, duration: number) {
        this.cache.set(key, {
            expiresAt: Date.now() + duration * 1000,
            data: value
        });
    }

    getCached<T>(key: any): T|undefined {
        const cachedData = this.cache.get(key);
        if (cachedData) {
            const date = Date.now();
            if (date > cachedData.expiresAt) {
                this.cache.delete(key);
                return undefined;
            }

            return cachedData.data;
        }
        return undefined;
    }

    async invalidateCached(key: any, emit = true) {
        this.cache.delete(key);

        if (this.redisConnection && emit) {
            await this.redisConnection.publish(RedisChannels.CacheInvalidation, key);
        }
    }
}