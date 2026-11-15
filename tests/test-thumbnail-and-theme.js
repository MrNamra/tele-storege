const assert = require('assert');
const telegramService = require('../services/telegramService');
const { safeEncryptId, safeDecryptId, isCompactSignedIdForBucket } = require('../utils/crypto');

console.log('Testing video thumbnail and crypto functions...');

// 1. Check exports
assert.strictEqual(typeof telegramService.extractVideoThumbnail, 'function', 'extractVideoThumbnail must be exported');
assert.strictEqual(typeof telegramService.streamThumbnail, 'function', 'streamThumbnail must be exported');
assert.strictEqual(typeof telegramService.isHeicFile, 'function', 'isHeicFile must be exported');

// 2. Test crypto roundtrip for signed thumbnail and media URLs
const bucketId = 4;
const msgId = 12345;
const encId = safeEncryptId(msgId, bucketId);

assert.ok(encId && typeof encId === 'string', 'encId must be a non-empty string');
assert.strictEqual(isCompactSignedIdForBucket(encId, bucketId), true, 'encId must verify for bucketId');
assert.strictEqual(isCompactSignedIdForBucket(encId, 999), false, 'encId must not verify for different bucketId');

const decrypted = safeDecryptId(encId, bucketId);
assert.strictEqual(decrypted, msgId, 'safeDecryptId must restore original msgId');

const wrongBucketDecrypt = safeDecryptId(encId, 999);
assert.strictEqual(wrongBucketDecrypt, null, 'safeDecryptId must return null for wrong bucket');

console.log('✓ All thumbnail and crypto self-checks passed successfully.');
