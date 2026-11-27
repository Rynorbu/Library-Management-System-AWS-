import { config } from '../config.js';

/**
 * Database credentials from AWS Secrets Manager (no passwords in code or env).
 *
 * RDS-managed master secrets ROTATE (every 7 days by default), so the value is never
 * kept forever: it is cached for SECRET_CACHE_TTL_SECONDS (default 300) and dropped
 * early with invalidateDbSecret() when PostgreSQL rejects the password (error 28P01).
 */

/**
 * A small TTL cache around an async fetch.
 *  - concurrent callers share one in-flight request
 *  - if a refresh fails, the previous value is served until invalidate() is called
 *  - a fetch that started before invalidate() is not cached (it may hold the old password)
 */
export function createSecretCache(fetchSecret, { ttlMs = 300_000, now = () => Date.now() } = {}) {
  let value;
  let fetchedAt = 0;
  let inFlight = null;
  let generation = 0;

  return {
    async get() {
      if (value !== undefined && now() - fetchedAt < ttlMs) return value;
      if (!inFlight) {
        const gen = generation;
        const request = (async () => {
          try {
            const fresh = await fetchSecret();
            if (gen === generation) {
              value = fresh;
              fetchedAt = now();
            }
            return fresh;
          } catch (err) {
            if (value !== undefined) {
              console.warn('[secrets] refresh failed, using the cached value:', err.message);
              return value;
            }
            throw err;
          }
        })();
        inFlight = request;
        const done = () => {
          if (inFlight === request) inFlight = null;
        };
        request.then(done, done);
      }
      return inFlight;
    },
    invalidate() {
      generation += 1;
      value = undefined;
      fetchedAt = 0;
      inFlight = null;
    },
  };
}

let client;
async function fetchFromSecretsManager(secretId) {
  const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
  client ??= new SecretsManagerClient({ region: config.awsRegion });
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  return JSON.parse(res.SecretString);
}

const caches = new Map();
function cacheFor(secretId) {
  if (!caches.has(secretId)) {
    caches.set(secretId, createSecretCache(() => fetchFromSecretsManager(secretId), { ttlMs: config.secretCacheTtlMs }));
  }
  return caches.get(secretId);
}

/** The secret's JSON ({ username, password, ... }), at most SECRET_CACHE_TTL_SECONDS old. */
export const getDbSecret = (secretId) => cacheFor(secretId).get();

/** Forget the cached value, so the next getDbSecret() reads Secrets Manager again. */
export const invalidateDbSecret = (secretId) => caches.get(secretId)?.invalidate();
