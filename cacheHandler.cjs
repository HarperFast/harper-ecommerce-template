'use strict';

/**
 * Next.js Incremental Cache handler backed by Harper tables (issue #5).
 *
 * Wired in next.config.js via `cacheHandler` (with `cacheMaxMemorySize: 0` so
 * the default in-memory LRU is disabled). The app runs inside Harper through
 * @harperfast/nextjs, so Harper's globals (`globalThis.databases`) are
 * available at request time. Outside Harper — e.g. during `next build` — every
 * operation degrades to a cache MISS / no-op so builds never depend on a
 * running database.
 *
 * Tables (database `appCache`, see schema.graphql):
 * - Cache: one row per incremental-cache entry; the Next payload is
 *   v8-serialized into a Blob column.
 * - CacheInvalidation: soft-invalidation log (id = tag | groupCode | path).
 *   Mirrored in memory and kept current cross-worker via a table subscription.
 * - CacheRules: path-pattern policy (bypass, group codes), seeded from
 *   resources.js. Lowest `priority` value wins.
 */

const v8 = require('node:v8');

const CACHE_RULES_REFRESH_MS = 30_000;

// Module-level state so every CacheHandler instance in this worker shares one
// rules cache, one invalidation mirror, and one table subscription.
const invalidationTimes = new Map();
let cachedRules = null;
let rulesLoadedAt = 0;
let initialized = false;

function getAppCache() {
	return globalThis.databases ? globalThis.databases.appCache : undefined;
}

function trace(message, error) {
	const logger = globalThis.logger;
	if (logger && typeof logger.trace === 'function') {
		// Key/rule names only — never cache payloads or headers.
		logger.trace(`cacheHandler: ${message}${error ? `: ${error.message}` : ''}`);
	}
}

// Harper 5 Blob! columns are returned as FileBackedBlob with async byte
// accessors; resolve to a Buffer before v8.deserialize.
async function toBuffer(data) {
	if (data == null) return undefined;
	if (Buffer.isBuffer(data)) return data;
	if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	if (typeof data.bytes === 'function') return Buffer.from(await data.bytes());
	if (typeof data.arrayBuffer === 'function') return Buffer.from(await data.arrayBuffer());
	return undefined;
}

// createBlob may return the Blob directly or a Promise of it; callers await.
function toStoredBlob(buffer) {
	return typeof globalThis.createBlob === 'function' ? globalThis.createBlob(buffer) : buffer;
}

// Cache keys for routes are pathnames ('/products/1'); fetch-cache keys are
// hashes and simply match no rule.
function pathOf(cacheKey) {
	return typeof cacheKey === 'string' && cacheKey.startsWith('/') ? cacheKey.split('?')[0] : undefined;
}

async function loadRules(appCache) {
	const rules = [];
	// search() with no arguments is a full scan; CacheRules is a handful of rows.
	for await (const rule of appCache.CacheRules.search()) {
		const patterns = [];
		for (const pattern of rule.pathPatterns ?? []) {
			try {
				patterns.push(new RegExp(pattern));
			} catch (error) {
				trace(`invalid pathPattern in rule ${rule.id}`, error);
			}
		}
		rules.push({
			id: rule.id,
			priority: rule.priority ?? Number.MAX_SAFE_INTEGER,
			patterns,
			groupCode: rule.groupCode,
			bypassCache: rule.bypassCache === true,
			neverExpire: rule.neverExpire === true,
		});
	}
	rules.sort((a, b) => a.priority - b.priority);
	return rules;
}

async function matchRule(appCache, cacheKey) {
	const path = pathOf(cacheKey);
	if (path === undefined) return undefined;
	const now = Date.now();
	if (!cachedRules || now - rulesLoadedAt > CACHE_RULES_REFRESH_MS) {
		try {
			cachedRules = await loadRules(appCache);
			rulesLoadedAt = now;
		} catch (error) {
			trace('CacheRules load failed; continuing without rules', error);
			cachedRules = cachedRules ?? [];
			rulesLoadedAt = now;
		}
	}
	for (const rule of cachedRules) {
		if (rule.patterns.some((pattern) => pattern.test(path))) return rule;
	}
	return undefined;
}

function recordInvalidation(id, timestamp) {
	if (id == null) return;
	const key = String(id);
	const current = invalidationTimes.get(key);
	if (current === undefined || timestamp > current) invalidationTimes.set(key, timestamp);
}

// An entry is stale if any of its tags, its group code, or its URL was
// invalidated at or after the entry was last refreshed.
function isInvalidated(keys, refreshedAt) {
	for (const key of keys) {
		if (key == null) continue;
		const invalidatedAt = invalidationTimes.get(String(key));
		if (invalidatedAt !== undefined && invalidatedAt >= refreshedAt) return true;
	}
	return false;
}

// Load the persisted invalidation log into the in-memory mirror, then keep it
// current across workers by subscribing to CacheInvalidation changes.
function ensureInitialized(appCache) {
	if (initialized) return;
	initialized = true;
	(async () => {
		try {
			for await (const record of appCache.CacheInvalidation.search()) {
				recordInvalidation(record.id, record.timestamp ?? 0);
			}
		} catch (error) {
			trace('CacheInvalidation preload failed', error);
		}
		try {
			const subscription = await appCache.CacheInvalidation.subscribe({ omitCurrent: true });
			subscription.on('data', (event) => {
				if (event?.id == null) return;
				recordInvalidation(event.id, event.value?.timestamp ?? Date.now());
			});
			subscription.on('error', (error) => {
				trace('CacheInvalidation subscription error; using local invalidations only', error);
			});
		} catch (error) {
			trace('CacheInvalidation subscription unavailable; using local invalidations only', error);
		}
	})();
}

function collectTags(data, ctx) {
	const tags = new Set();
	for (const tag of ctx?.tags ?? []) tags.add(tag);
	for (const tag of data?.headers?.['x-next-cache-tags']?.split?.(',') ?? []) tags.add(tag);
	return [...tags];
}

module.exports = class CacheHandler {
	constructor(options) {
		this.options = options;
	}

	async get(cacheKey, ctx) {
		try {
			const appCache = getAppCache();
			if (!appCache) return null;
			ensureInitialized(appCache);
			const rule = await matchRule(appCache, cacheKey);
			if (rule?.bypassCache) return null;
			const entry = await appCache.Cache.get(cacheKey);
			if (!entry) return null;
			const refreshedAt = entry.refreshedAt ?? 0;
			let tags = [];
			try {
				tags = entry.cacheTags ? JSON.parse(entry.cacheTags) : [];
			} catch {
				tags = [];
			}
			const invalidationKeys = [...tags, ...(ctx?.tags ?? []), ...(ctx?.softTags ?? []), entry.groupCode, entry.url];
			if (isInvalidated(invalidationKeys, refreshedAt)) return null;
			const buffer = await toBuffer(entry.data);
			if (!buffer) return null;
			const value = v8.deserialize(buffer);
			return { value, lastModified: refreshedAt };
		} catch (error) {
			// Degrade to MISS; trace only so render paths never depend on the cache.
			trace(`get(${cacheKey}) degraded to MISS`, error);
			return null;
		}
	}

	async set(cacheKey, data, ctx) {
		try {
			const appCache = getAppCache();
			if (!appCache) return;
			ensureInitialized(appCache);
			if (data == null) {
				await appCache.Cache.delete(cacheKey);
				return;
			}
			const rule = await matchRule(appCache, cacheKey);
			if (rule?.bypassCache) return;
			const tags = collectTags(data, ctx);
			await appCache.Cache.put({
				cacheKey,
				kind: data.kind,
				data: await toStoredBlob(v8.serialize(data)),
				headers: data.headers ? JSON.stringify(data.headers) : undefined,
				cacheTags: tags.length ? JSON.stringify(tags) : undefined,
				groupCode: rule?.groupCode,
				url: pathOf(cacheKey),
				refreshedAt: Date.now(),
			});
		} catch (error) {
			trace(`set(${cacheKey}) skipped`, error);
		}
	}

	async revalidateTag(tags) {
		const tagList = [tags].flat().filter((tag) => tag != null);
		const timestamp = Date.now();
		for (const tag of tagList) recordInvalidation(tag, timestamp);
		try {
			const appCache = getAppCache();
			if (!appCache) return;
			for (const tag of tagList) {
				await appCache.CacheInvalidation.put({ id: tag, timestamp });
			}
		} catch (error) {
			trace('revalidateTag persistence failed; invalidation applied locally', error);
		}
	}

	resetRequestCache() {}
};
