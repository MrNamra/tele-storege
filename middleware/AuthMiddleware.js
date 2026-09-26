const db = require('../config/db');
const { hashToken, isCompactSignedIdForBucket } = require('../utils/crypto');

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  if (req.query && req.query.token) {
    return String(req.query.token).trim();
  }
  return null;
}

function resolveUserFromToken(rawToken) {
  if (!rawToken) return null;

  let tokenRecord = null;

  if (rawToken.includes('|')) {
    const parts = rawToken.split('|');
    const tokenId = parts[0];
    const plainToken = parts[1];
    const hashed = hashToken(plainToken);

    tokenRecord = db
      .prepare('SELECT * FROM personal_access_tokens WHERE id = ? AND token = ?')
      .get(tokenId, hashed);

    if (!tokenRecord) {
      // Also try direct plain token match in case stored unhashed
      tokenRecord = db
        .prepare('SELECT * FROM personal_access_tokens WHERE id = ? AND token = ?')
        .get(tokenId, plainToken);
    }
  } else {
    const hashed = hashToken(rawToken);
    tokenRecord = db
      .prepare('SELECT * FROM personal_access_tokens WHERE token = ? OR token = ?')
      .get(hashed, rawToken);
  }

  if (!tokenRecord) {
    return null;
  }

  // Update last_used_at timestamp
  try {
    db.prepare('UPDATE personal_access_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(tokenRecord.id);
  } catch {}

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(tokenRecord.tokenable_id);
  return user || null;
}

function authMiddleware(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ status: false, message: 'Unauthenticated.' });
  }

  const user = resolveUserFromToken(token);
  if (!user) {
    return res.status(401).json({ status: false, message: 'Unauthenticated.' });
  }

  if (user.status === 'suspended') {
    return res.status(403).json({
      status: false,
      message: `Account is suspended: ${user.status_reason || 'Please contact an administrator.'}`,
    });
  }

  req.user = user;
  next();
}

function optionalAuthMiddleware(req, res, next) {
  const token = extractToken(req);
  if (token) {
    const user = resolveUserFromToken(token);
    if (user && user.status !== 'suspended') {
      req.user = user;
    }
  }
  next();
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      status: false,
      message: 'Forbidden. Admin privileges required.',
    });
  }
  next();
}

function canAccessBucket(req, bucket) {
  if (!bucket) return false;

  // 1. Shared bucket: public read access
  const isShared = db.prepare('SELECT id FROM bucket_shares WHERE bucket_id = ?').get(bucket.id);
  if (isShared) return true;

  // 2. Private bucket: user must be the bucket owner
  const user = req.user || resolveUserFromToken(extractToken(req));
  if (user && Number(bucket.user_id) === Number(user.id)) {
    return true;
  }

  // 3. Compact HMAC signed media token for this bucket (zero DB, tamper-proof)
  const fileId = req.params.id || req.query.file_id || req.body.file_id;
  if (fileId && isCompactSignedIdForBucket(String(fileId), bucket.id)) {
    return true;
  }

  return false;
}

module.exports = {
  extractToken,
  resolveUserFromToken,
  authMiddleware,
  optionalAuthMiddleware,
  adminMiddleware,
  canAccessBucket,
};