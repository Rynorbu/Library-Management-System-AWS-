/**
 * Unit tests without a database: the secret cache and auth retry behind C1, and the
 * RDS TLS settings behind C3.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';

process.env.NODE_ENV = 'test';
console.warn = () => {}; // the code under test warns on purpose (retry, stale secret)
const { createSecretCache } = await import('../src/services/secrets.js');
const { retryOnAuthFailure, sslOptions } = await import('../src/db/index.js');

const authError = () => Object.assign(new Error('password authentication failed'), { code: '28P01' });

describe('secret cache (C1)', () => {
  it('serves the cached value within the TTL', async () => {
    let calls = 0;
    const cache = createSecretCache(async () => ({ password: `p${++calls}` }), { ttlMs: 1000 });
    assert.equal((await cache.get()).password, 'p1');
    assert.equal((await cache.get()).password, 'p1');
    assert.equal(calls, 1);
  });

  it('shares one request between concurrent callers', async () => {
    let calls = 0;
    const cache = createSecretCache(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { password: 'p' };
    });
    await Promise.all([cache.get(), cache.get(), cache.get()]);
    assert.equal(calls, 1);
  });

  it('reads the secret again after the TTL, so a rotated password is picked up', async () => {
    let clock = 0;
    let calls = 0;
    const cache = createSecretCache(async () => ({ password: `p${++calls}` }), { ttlMs: 300_000, now: () => clock });
    assert.equal((await cache.get()).password, 'p1');
    clock += 299_999;
    assert.equal((await cache.get()).password, 'p1');
    clock += 2;
    assert.equal((await cache.get()).password, 'p2');
  });

  it('reads the secret again at once after invalidate()', async () => {
    let calls = 0;
    const cache = createSecretCache(async () => ({ password: `p${++calls}` }));
    await cache.get();
    cache.invalidate();
    assert.equal((await cache.get()).password, 'p2');
  });

  it('keeps serving the last value if Secrets Manager is briefly unreachable', async () => {
    let clock = 0;
    let fail = false;
    const cache = createSecretCache(
      async () => {
        if (fail) throw new Error('network down');
        return { password: 'p1' };
      },
      { ttlMs: 10, now: () => clock },
    );
    await cache.get();
    fail = true;
    clock = 100;
    assert.equal((await cache.get()).password, 'p1');
  });

  it('throws when there is no value to fall back on', async () => {
    const cache = createSecretCache(async () => {
      throw new Error('AccessDenied');
    });
    await assert.rejects(cache.get(), /AccessDenied/);
  });

  it('does not cache a read that started before invalidate()', async () => {
    let release;
    let calls = 0;
    const cache = createSecretCache(async () => {
      calls += 1;
      if (calls === 1) await new Promise((r) => (release = r));
      return { password: `p${calls}` };
    });
    const slow = cache.get();
    await new Promise((r) => setImmediate(r));
    cache.invalidate();
    release();
    assert.equal((await slow).password, 'p1');
    assert.equal((await cache.get()).password, 'p2', 'the old read was not cached');
  });
});

describe('retry on authentication failure (C1)', () => {
  it('refreshes the secret and retries once when PostgreSQL rejects the password', async () => {
    let attempts = 0;
    let refreshed = 0;
    const result = await retryOnAuthFailure(
      async () => {
        attempts += 1;
        if (attempts === 1) throw authError();
        return 'ok';
      },
      () => {
        refreshed += 1;
      },
    );
    assert.equal(result, 'ok');
    assert.equal(attempts, 2);
    assert.equal(refreshed, 1);
  });

  it('gives up after one retry', async () => {
    let attempts = 0;
    await assert.rejects(
      retryOnAuthFailure(
        async () => {
          attempts += 1;
          throw authError();
        },
        () => {},
      ),
      { code: '28P01' },
    );
    assert.equal(attempts, 2);
  });

  it('does not retry other errors, or when there is no secret to refresh', async () => {
    let attempts = 0;
    const other = Object.assign(new Error('syntax error'), { code: '42601' });
    await assert.rejects(retryOnAuthFailure(async () => { attempts += 1; throw other; }, () => {}), { code: '42601' });
    await assert.rejects(retryOnAuthFailure(async () => { attempts += 1; throw authError(); }, null), { code: '28P01' });
    assert.equal(attempts, 2);
  });
});

describe('RDS TLS settings (C3)', () => {
  it('verifies the certificate against the bundled Amazon RDS CAs', () => {
    const ssl = sslOptions(true);
    assert.equal(ssl.rejectUnauthorized, true);
    const certs = ssl.ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
    assert.ok(certs.length > 50, `${certs.length} CA certificates in the bundle`);
    const subjects = certs.map((pem) => new X509Certificate(pem).subject);
    assert.ok(subjects.every((s) => s.includes('Amazon RDS')), 'only Amazon RDS CAs');
    assert.ok(subjects.some((s) => s.includes('us-east-1')), 'includes the us-east-1 root');
  });

  it('can encrypt without verification for troubleshooting', () => {
    assert.deepEqual(sslOptions('no-verify'), { rejectUnauthorized: false });
  });

  it('uses no TLS when DB_SSL is off (local Docker)', () => {
    assert.equal(sslOptions(false), undefined);
    assert.equal(sslOptions(undefined), undefined);
  });
});
