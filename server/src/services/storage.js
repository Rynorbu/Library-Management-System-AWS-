import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

/**
 * Book cover storage. In AWS: private S3 bucket + short-lived presigned URLs.
 * Locally: files under server/uploads served by Express.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

let s3;
let presign;
const presignCache = new Map(); // key -> { url, expires }

async function s3Client() {
  if (!s3) {
    const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    s3 = { client: new S3Client({ region: config.awsRegion }), PutObjectCommand, GetObjectCommand };
    presign = getSignedUrl;
  }
  return s3;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export async function saveCover(file) {
  const ext = EXT[file.mimetype];
  if (!ext) throw Object.assign(new Error('Cover must be a JPEG, PNG, WebP or GIF image'), { status: 400 });
  const key = `covers/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;

  if (config.s3Bucket) {
    const { client, PutObjectCommand } = await s3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: config.s3Bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  } else {
    const dest = path.join(UPLOAD_DIR, key);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, file.buffer);
  }
  return key;
}

async function resolveKey(key) {
  if (!config.s3Bucket) return `/uploads/${key}`;
  const hit = presignCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { client, GetObjectCommand } = await s3Client();
  const url = await presign(client, new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }), { expiresIn: 3600 });
  presignCache.set(key, { url, expires: Date.now() + 50 * 60 * 1000 });
  return url;
}

/** Attach a browser-usable `cover` URL to one or many book rows. */
export async function withCoverUrls(books) {
  const list = Array.isArray(books) ? books : [books];
  await Promise.all(
    list.map(async (b) => {
      if (!b) return;
      b.cover = b.cover_key ? await resolveKey(b.cover_key).catch(() => b.cover_url || null) : b.cover_url || null;
    }),
  );
  return books;
}
