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
const INVALIDATION_RESYNC_MS = 30_000;
const INVALIDATION_PUT_RETRY_MS = 5_000;
// Must match the CacheInvalidation table's `expiration: 604800` (seconds → ms).
const INVALIDATION_TTL_MS = 604_800_000;
const INVALIDATION_EVICT_INTERVAL_MS = 3_600_000; // check once per hour
// Thresholds for escalating get() failure log level so a cache outage (DB down,
// schema missing, etc.) surfaces in production logs rather than staying silent.
const GET_WARN_THRESHOLD = 5;
const GET_ERROR_THRESHOLD = 20;

// Module-level state so every CacheHandler instance in this worker shares one
// rules cache, one invalidation mirror, and one table subscription.
const invalidationTimes = new Map();
// Tags whose CacheInvalidation row failed to persist, awaiting retry
// (tag -> invalidation timestamp; the newest timestamp wins on merge).
const pendingInvalidationWrites = new Map();
let invalidationRetryTimer = null;
let rulesPromise = null;
let rulesLoadedAt = 0;
let initializationPromise = null;
let evictionStarted = false;
let consecutiveGetFailures = 0;

function getAppCache() {
	return globalThis.databases ? globalThis.databases.appCache : undefined;
}

function logAt(level, message, error) {
	const logger = globalThis.logger;
	if (logger && typeof logger[level] === 'function') {
		// Key/rule names only — never cache payloads or headers.
		logger[level](`cacheHandler: ${message}${error ? `: ${error.message}` : ''}`);
	}
}

function trace(message, error) {
	logAt('trace', message, error);
}

// Cache-coherency failures (lost invalidations, dead subscriptions) must be
// visible in production logs — other workers serve stale data until resolved.
function warn(message, error) {
	logAt('warn', message, error);
}

function logError(message, error) {
	logAt('error', message, error);
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

// Promise-cached so concurrent callers awaiting an empty/stale cache share one
// in-flight CacheRules read instead of each issuing a duplicate DB scan.
function getRules(appCache) {
	const now = Date.now();
	if (!rulesPromise || now - rulesLoadedAt > CACHE_RULES_REFRESH_MS) {
		const previousRules = rulesPromise;
		rulesLoadedAt = now;
		rulesPromise = loadRules(appCache).catch((error) => {
			trace('CacheRules load failed; continuing without rules', error);
			// Keep serving the last good rules (or none on the first load).
			return previousRules ?? [];
		});
	}
	return rulesPromise;
}

async function matchRule(appCache, cacheKey) {
	const path = pathOf(cacheKey);
	if (path === undefined) return undefined;
	const rules = await getRules(appCache);
	for (const rule of rules) {
		if (rule.patterns.some((pattern) => pattern.test(path))) return rule;
	}
	return undefined;
}

function recordInvalidation(id, timestamp) {
	if (id == null) return;
	// Trim so a tag stored as " pdp" still matches the invalidation key "pdp".
	const key = String(id).trim();
	if (key === '') return;
	const current = invalidationTimes.get(key);
	if (current === undefined || timestamp > current) invalidationTimes.set(key, timestamp);
}

// An entry is stale if any of its tags, its group code, or its URL was
// invalidated at or after the entry was last refreshed.
function isInvalidated(keys, refreshedAt) {
	for (const key of keys) {
		if (key == null) continue;
		const normalized = String(key).trim();
		if (normalized === '') continue;
		const invalidatedAt = invalidationTimes.get(normalized);
		if (invalidatedAt !== undefined && invalidatedAt >= refreshedAt) return true;
	}
	return false;
}

// Purge entries older than INVALIDATION_TTL_MS once per hour. The in-memory
// mirror would otherwise grow without bound because invalidationTimes has no
// eviction of its own — this mirrors the DB table's 7-day TTL.
function startEvictionTimer() {
	if (evictionStarted) return;
	evictionStarted = true;
	const timer = setInterval(() => {
		const cutoff = Date.now() - INVALIDATION_TTL_MS;
		for (const [key, ts] of invalidationTimes) {
			if (ts < cutoff) invalidationTimes.delete(key);
		}
	}, INVALIDATION_EVICT_INTERVAL_MS);
	if (typeof timer.unref === 'function') timer.unref();
}

// Load the persisted invalidation log into the in-memory mirror, then keep it
// current across workers by subscribing to CacheInvalidation changes. On
// subscribe failure, retry the full sync (preload + subscribe) after a delay so
// invalidations written by other workers while unsubscribed are eventually
// picked up, even if the real-time subscription keeps failing.
async function syncInvalidations(appCache) {
	startEvictionTimer();
	try {
		for await (const record of appCache.CacheInvalidation.search()) {
			recordInvalidation(record.id, record.timestamp ?? 0);
		}
	} catch (error) {
		warn('CacheInvalidation preload failed; invalidations from other workers may be missed', error);
	}
	try {
		const subscription = await appCache.CacheInvalidation.subscribe({ omitCurrent: true });
		subscription.on('data', (event) => {
			if (event?.id == null) return;
			const ts = event.value?.timestamp;
			if (typeof ts !== 'number') {
				warn(`CacheInvalidation subscription received event without a valid timestamp for id=${event.id}; ignoring`);
				return;
			}
			recordInvalidation(event.id, ts);
		});
		subscription.on('error', (error) => {
			warn('CacheInvalidation subscription error; cross-worker invalidations may be delayed', error);
		});
	} catch (error) {
		warn(
			`CacheInvalidation subscription unavailable; retrying in ${INVALIDATION_RESYNC_MS}ms (cross-worker invalidations not visible until then)`,
			error
		);
		const timer = setTimeout(() => {
			void syncInvalidations(appCache);
		}, INVALIDATION_RESYNC_MS);
		// Never hold the process open just for the resync loop.
		if (typeof timer.unref === 'function') timer.unref();
	}
}

function ensureInitialized(appCache) {
	if (!initializationPromise) {
		initializationPromise = syncInvalidations(appCache);
	}
	return initializationPromise;
}

// Write each invalidation row individually so one failing tag never abandons
// the rest. Returns the entries that failed (tag -> timestamp). A successful
// put supersedes any older pending retry for the same tag — a newer persisted
// invalidation timestamp invalidates strictly more than an older one.
async function persistInvalidations(appCache, entries) {
	const failed = new Map();
	for (const [tag, timestamp] of entries) {
		try {
			await appCache.CacheInvalidation.put({ id: tag, timestamp });
			const pending = pendingInvalidationWrites.get(tag);
			if (pending !== undefined && pending <= timestamp) pendingInvalidationWrites.delete(tag);
		} catch (error) {
			failed.set(tag, timestamp);
			trace(`CacheInvalidation.put(${tag}) failed`, error);
		}
	}
	return failed;
}

// Queue failed invalidation writes and (re)arm the backoff timer. Mirrors the
// syncInvalidations retry pattern: cross-worker coherency depends on these
// rows landing eventually, so keep retrying only the failed tags.
function queueInvalidationRetry(failed) {
	for (const [tag, timestamp] of failed) {
		const current = pendingInvalidationWrites.get(tag);
		if (current === undefined || timestamp > current) pendingInvalidationWrites.set(tag, timestamp);
	}
	scheduleInvalidationRetry();
}

function scheduleInvalidationRetry() {
	if (invalidationRetryTimer || pendingInvalidationWrites.size === 0) return;
	invalidationRetryTimer = setTimeout(() => {
		invalidationRetryTimer = null;
		void retryPendingInvalidations();
	}, INVALIDATION_PUT_RETRY_MS);
	// Never hold the process open just for the retry loop.
	if (typeof invalidationRetryTimer.unref === 'function') invalidationRetryTimer.unref();
}

async function retryPendingInvalidations() {
	const appCache = getAppCache();
	if (!appCache) {
		scheduleInvalidationRetry();
		return;
	}
	// Snapshot then clear: writes that fail again (or new failures merged in
	// while this batch runs) re-queue via queueInvalidationRetry, newest
	// timestamp winning.
	const batch = new Map(pendingInvalidationWrites);
	pendingInvalidationWrites.clear();
	const failed = await persistInvalidations(appCache, batch);
	if (failed.size) {
		warn(
			`CacheInvalidation retry failed for [${[...failed.keys()].join(', ')}]; retrying in ${INVALIDATION_PUT_RETRY_MS}ms`
		);
		queueInvalidationRetry(failed);
	} else if (pendingInvalidationWrites.size) {
		// New failures arrived while this batch was in flight.
		scheduleInvalidationRetry();
	}
}

// Tags are trimmed on the way in so stored cacheTags always match the trimmed
// keys recordInvalidation() uses.
function collectTags(data, ctx) {
	const tags = new Set();
	for (const tag of ctx?.tags ?? []) {
		const trimmed = typeof tag === 'string' ? tag.trim() : tag;
		if (trimmed != null && trimmed !== '') tags.add(trimmed);
	}
	for (const tag of data?.headers?.['x-next-cache-tags']?.split?.(',') ?? []) {
		const trimmed = tag.trim();
		if (trimmed !== '') tags.add(trimmed);
	}
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
			await ensureInitialized(appCache);
			const rule = await matchRule(appCache, cacheKey);
			if (rule?.bypassCache) return null;
			const entry = await appCache.Cache.get(cacheKey);
			// DB responded — reset the persistent-failure counter.
			consecutiveGetFailures = 0;
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
			// Degrade to MISS. Escalate log level for persistent failures so a
			// cache outage (DB down, schema missing) is visible in production logs.
			consecutiveGetFailures++;
			if (consecutiveGetFailures >= GET_ERROR_THRESHOLD) {
				logError(`get(${cacheKey}) degraded to MISS (${consecutiveGetFailures} consecutive failures — possible cache outage)`, error);
			} else if (consecutiveGetFailures >= GET_WARN_THRESHOLD) {
				warn(`get(${cacheKey}) degraded to MISS (${consecutiveGetFailures} consecutive failures)`, error);
			} else {
				trace(`get(${cacheKey}) degraded to MISS`, error);
			}
			return null;
		}
	}

	async set(cacheKey, data, ctx) {
		try {
			const appCache = getAppCache();
			if (!appCache) return;
			await ensureInitialized(appCache);
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
		const tagList = [tags]
			.flat()
			.filter((tag) => tag != null)
			.map((tag) => String(tag).trim())
			.filter((tag) => tag !== '');
		const timestamp = Date.now();
		// The in-memory mirror is updated immediately so this worker's view is
		// current regardless of whether the DB write has landed yet.
		for (const tag of tagList) recordInvalidation(tag, timestamp);
		const appCache = getAppCache();
		if (!appCache) return;
		const failed = await persistInvalidations(
			appCache,
			tagList.map((tag) => [tag, timestamp])
		);
		if (failed.size) {
			// Until these rows persist, other workers serve stale data for the
			// failed tags — keep retrying on a backoff like syncInvalidations does.
			logError(
				`revalidateTag persistence failed for [${[...failed.keys()].join(', ')}]; applied locally, retrying in ${INVALIDATION_PUT_RETRY_MS}ms`
			);
			queueInvalidationRetry(failed);
		}
	}

	resetRequestCache() {}
};
