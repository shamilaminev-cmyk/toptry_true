import crypto from 'crypto';
import { Client as MinioClient } from 'minio';

let minio = null;
const BUCKET = process.env.MINIO_BUCKET || 'toptry';

export function getMinio() {
  if (minio) return { minio, bucket: BUCKET };
  const endp = process.env.MINIO_ENDPOINT;
  const key = process.env.MINIO_ACCESS_KEY;
  const secret = process.env.MINIO_SECRET_KEY;
  if (!endp || !key || !secret) return null;

  // MINIO_ENDPOINT can be "localhost:9000" or just "localhost" + MINIO_PORT.
  const [host, portStr] = endp.includes(':') ? endp.split(':') : [endp, process.env.MINIO_PORT || '9000'];
  const port = Number(portStr || '9000');

  minio = new MinioClient({
    endPoint: host,
    port,
    useSSL: String(process.env.MINIO_USE_SSL || 'false') === 'true',
    accessKey: key,
    secretKey: secret,
  });
  return { minio, bucket: BUCKET };
}

export async function ensureBucket() {
  const cli = getMinio();
  if (!cli) return;
  const { minio: c, bucket } = cli;
  const exists = await c.bucketExists(bucket).catch(() => false);
  if (!exists) {
    await c.makeBucket(bucket, 'us-east-1');
  }
}

export function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('Expected data URL');
  }
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new Error('Invalid data URL');
  const meta = dataUrl.slice(0, comma);
  const base64 = dataUrl.slice(comma + 1);
  const m = meta.match(/data:([^;]+);base64/);
  const mimeType = m ? m[1] : 'application/octet-stream';
  return { mimeType, base64 };
}

export async function putDataUrl(dataUrl, prefix) {
  const cli = getMinio();
  if (!cli) return null;
  const { minio: c, bucket } = cli;
  const { mimeType, base64 } = parseDataUrl(dataUrl);
  const buf = Buffer.from(base64, 'base64');
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const key = `${prefix}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
  await c.putObject(bucket, key, buf, {
    'Content-Type': mimeType,
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  return { key, mimeType };
}

export async function getObjectStream(key) {
  const cli = getMinio();
  if (!cli) return null;
  const { minio: c, bucket } = cli;
  return c.getObject(bucket, key);
}
