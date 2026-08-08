/**
 * Cloudflare R2 upload helpers (S3-compatible API).
 *
 * Required env vars:
 *   R2_ACCOUNT_ID         — Cloudflare account ID
 *   R2_ACCESS_KEY_ID      — R2 API token access key
 *   R2_SECRET_ACCESS_KEY  — R2 API token secret
 *
 * Optional env vars (sensible defaults for this project):
 *   R2_BUCKET_NAME   — defaults to "dreamstick-assets"
 *   R2_PUBLIC_URL    — defaults to the known pub-*.r2.dev domain
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'fs';

const R2_DEFAULT_PUBLIC_URL = 'https://pub-c6814ff127874397be8590901348d4ff.r2.dev';
const R2_DEFAULT_BUCKET     = 'dreamstick-assets';

function makeR2Client(): S3Client | null {
  const accountId       = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId     = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region:      'auto',
    endpoint:    `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function r2Bucket(): string {
  return (process.env.R2_BUCKET_NAME?.trim() || R2_DEFAULT_BUCKET);
}

/** Returns the public CDN URL for a video object key. */
export function r2PublicVideoUrl(filename: string): string {
  const base = (process.env.R2_PUBLIC_URL?.trim() || R2_DEFAULT_PUBLIC_URL).replace(/\/$/, '');
  return `${base}/videos/${filename}`;
}

/**
 * Upload a local MP4 file to R2 under videos/<filename>.
 * Returns the public CDN URL on success, throws on failure.
 */
export async function uploadToR2(localPath: string, filename: string): Promise<string> {
  const client = makeR2Client();
  if (!client) {
    throw new Error(
      'R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY',
    );
  }
  const key = `videos/${filename}`;
  await client.send(new PutObjectCommand({
    Bucket:       r2Bucket(),
    Key:          key,
    Body:         createReadStream(localPath),
    ContentType:  'video/mp4',
    CacheControl: 'public, max-age=86400',
  }));
  const publicUrl = r2PublicVideoUrl(filename);
  console.log(`[r2] Uploaded ${filename} → ${publicUrl}`);
  return publicUrl;
}

/**
 * Returns true if videos/<filename> exists in R2.
 * Never throws — returns false on any error or if R2 is not configured.
 */
export async function r2FileExists(filename: string): Promise<boolean> {
  const client = makeR2Client();
  if (!client) return false;
  try {
    await client.send(new HeadObjectCommand({
      Bucket: r2Bucket(),
      Key:    `videos/${filename}`,
    }));
    return true;
  } catch {
    return false;
  }
}
