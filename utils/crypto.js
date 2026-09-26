const crypto = require('crypto');

function getShortCipherKey() {
  const appKey = process.env.APP_KEY || 'base64:tele-storage-default-secret-key-32b=';
  return crypto.createHash('sha256').update(appKey).digest().subarray(0, 16);
}

function safeEncryptId(id, bucketId = 0) {
  if (!id) return '';
  const key = getShortCipherKey();
  const payload = Buffer.alloc(8);
  payload.writeUInt32BE(Number(id), 0);
  payload.writeUInt32BE(Number(bucketId), 4);
  const hmac = crypto.createHmac('sha256', key).update(payload).digest().subarray(0, 8);
  const block = Buffer.concat([payload, hmac]);
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(false);
  const enc = Buffer.concat([cipher.update(block), cipher.final()]);
  return enc.toString('base64url');
}

function isCompactSignedIdForBucket(id, bucketId) {
  if (typeof id !== 'string' || id.length !== 22) return false;
  const key = getShortCipherKey();
  try {
    const raw = Buffer.from(id, 'base64url');
    if (raw.length !== 16) return false;
    const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
    decipher.setAutoPadding(false);
    const dec = Buffer.concat([decipher.update(raw), decipher.final()]);
    if (dec.length !== 16) return false;
    const payload = dec.subarray(0, 8);
    const hmac = dec.subarray(8, 16);
    const expectedHmac = crypto.createHmac('sha256', key).update(payload).digest().subarray(0, 8);
    if (!crypto.timingSafeEqual(expectedHmac, hmac)) return false;
    const tokenBucketId = payload.readUInt32BE(4);
    return tokenBucketId === Number(bucketId) || tokenBucketId === 0;
  } catch {
    return false;
  }
}

function safeDecryptId(id, expectedBucketId = null) {
  if (!id) return null;
  if (/^\d+$/.test(id)) return parseInt(id, 10);
  if (typeof id === 'string' && id.length === 22) {
    try {
      const key = getShortCipherKey();
      const raw = Buffer.from(id, 'base64url');
      if (raw.length === 16) {
        const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
        decipher.setAutoPadding(false);
        const dec = Buffer.concat([decipher.update(raw), decipher.final()]);
        if (dec.length === 16) {
          const payload = dec.subarray(0, 8);
          const hmac = dec.subarray(8, 16);
          const expectedHmac = crypto.createHmac('sha256', key).update(payload).digest().subarray(0, 8);
          if (crypto.timingSafeEqual(expectedHmac, hmac)) {
            const msgId = payload.readUInt32BE(0);
            const tokenBucketId = payload.readUInt32BE(4);
            if (expectedBucketId !== null && tokenBucketId !== 0 && tokenBucketId !== Number(expectedBucketId)) {
              return null;
            }
            if (msgId > 0) return msgId;
          }
        }
      }
    } catch {}
  }
  return null;
}

function hashToken(plainToken) {
  return crypto.createHash('sha256').update(plainToken).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex'); // 64 hex characters
}

module.exports = {
  getShortCipherKey,
  safeEncryptId,
  safeDecryptId,
  isCompactSignedIdForBucket,
  hashToken,
  generateToken,
};
