const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mime = require('mime-types');
const db = require('../config/db');
const telegramService = require('../services/telegramService');
const { resolveUserFromToken } = require('../middleware/AuthMiddleware');
const { flexibleUpload } = require('../middleware/uploadMiddleware');
const { hashToken, generateToken, safeEncryptId, safeDecryptId } = require('../utils/crypto');
const { getUserPhotosBucket, ensureUserPhotosBucket } = require('../utils/photosBucket');

const router = express.Router();

// SQLite metadata index for Immich mobile app sync & deduplication (zero media bytes on disk)
db.exec(`
  CREATE TABLE IF NOT EXISTS "immich_assets" (
    "id" VARCHAR PRIMARY KEY NOT NULL,
    "user_id" INTEGER NOT NULL,
    "bucket_id" INTEGER NOT NULL,
    "msg_id" VARCHAR NOT NULL,
    "device_asset_id" VARCHAR,
    "device_id" VARCHAR,
    "checksum" VARCHAR NOT NULL,
    "file_name" VARCHAR NOT NULL,
    "mime_type" VARCHAR,
    "type" VARCHAR NOT NULL DEFAULT 'IMAGE',
    "size" INTEGER NOT NULL DEFAULT 0,
    "duration" VARCHAR,
    "is_favorite" INTEGER NOT NULL DEFAULT 0,
    "file_created_at" VARCHAR NOT NULL,
    "file_modified_at" VARCHAR NOT NULL,
    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    FOREIGN KEY("bucket_id") REFERENCES "buckets"("id") ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "idx_immich_assets_user_checksum" ON "immich_assets" ("user_id", "checksum");
  CREATE INDEX IF NOT EXISTS "idx_immich_assets_user_msg" ON "immich_assets" ("user_id", "bucket_id", "msg_id");

  CREATE TABLE IF NOT EXISTS "immich_sync_acks" (
    "token_key" VARCHAR NOT NULL,
    "entity_type" VARCHAR NOT NULL,
    "ack" VARCHAR NOT NULL,
    "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("token_key", "entity_type")
  );
`);

const IMMICH_VERSION = { major: 2, minor: 2, patch: 0 };
const IMMICH_VERSION_STR = `v${IMMICH_VERSION.major}.${IMMICH_VERSION.minor}.${IMMICH_VERSION.patch}`;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|flv|wmv|ts|3gp)$/i;

function deterministicUuid(namespace, value) {
  const bytes = crypto.createHash('sha256').update(`${namespace}:${value}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // UUIDv4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function userUuid(userId) {
  return deterministicUuid('cloudvault-user', String(userId));
}

function assetUuid(bucketId, msgId) {
  return deterministicUuid('cloudvault-asset', `${bucketId}:${msgId}`);
}

function isoDate(input) {
  if (!input) return new Date().toISOString();
  if (typeof input === 'number') return new Date(input * 1000).toISOString();
  const d = new Date(input);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function normalizeChecksum(raw) {
  if (!raw) return '';
  const str = String(raw).trim();
  if (/^[a-f0-9]{40}$/i.test(str)) {
    return Buffer.from(str, 'hex').toString('base64');
  }
  return str;
}

function sha1Base64File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const rs = fs.createReadStream(filePath);
    rs.on('error', reject);
    rs.on('data', (chunk) => hash.update(chunk));
    rs.on('end', () => resolve(hash.digest('base64')));
  });
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return out;
}

function extractImmichToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && /^bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^bearer\s+/i, '').trim();
  }
  if (req.headers['x-api-key']) {
    return String(req.headers['x-api-key']).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.immich_access_token) {
    return cookies.immich_access_token;
  }
  if (req.query && (req.query.key || req.query.token)) {
    return String(req.query.key || req.query.token).trim();
  }
  return null;
}

function immichAuth(req, res, next) {
  const token = extractImmichToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Authentication required', error: 'Unauthorized', statusCode: 401 });
  }
  const user = resolveUserFromToken(token);
  if (!user || user.status === 'suspended') {
    return res.status(401).json({ message: 'Invalid user token', error: 'Unauthorized', statusCode: 401 });
  }
  req.user = user;
  req.immichTokenKey = hashToken(token).slice(0, 32);
  next();
}

function mapImmichUser(user) {
  const created = isoDate(user.created_at);
  const updated = isoDate(user.updated_at || user.created_at);
  const usageRow = db.prepare('SELECT COALESCE(SUM(size), 0) as total FROM immich_assets WHERE user_id = ?').get(user.id);
  return {
    id: userUuid(user.id),
    email: user.email,
    name: user.name || user.email.split('@')[0],
    profileImagePath: '',
    avatarColor: 'primary',
    profileChangedAt: updated,
    isAdmin: user.role === 'admin',
    shouldChangePassword: false,
    storageLabel: null,
    status: 'active',
    oauthId: '',
    quotaSizeInBytes: null,
    quotaUsageInBytes: Number(usageRow?.total || 0),
    createdAt: created,
    updatedAt: updated,
    deletedAt: null,
    license: null,
    clusterGroupId: deterministicUuid('cloudvault-cluster', 'default'),
  };
}

function mapAssetResponse(row) {
  return {
    id: row.id,
    deviceAssetId: row.device_asset_id || row.id,
    ownerId: userUuid(row.user_id),
    deviceId: row.device_id || 'cloudvault',
    libraryId: null,
    type: row.type === 'VIDEO' ? 'VIDEO' : 'IMAGE',
    originalPath: `/photos/${row.file_name}`,
    originalFileName: row.file_name,
    originalMimeType: row.mime_type || mime.lookup(row.file_name) || 'application/octet-stream',
    thumbhash: null,
    fileCreatedAt: row.file_created_at,
    fileModifiedAt: row.file_modified_at,
    localDateTime: row.file_created_at,
    updatedAt: isoDate(row.updated_at || row.created_at),
    isFavorite: Boolean(row.is_favorite),
    isArchived: false,
    isTrashed: false,
    visibility: 'timeline',
    duration: row.duration || '0:00:00.00000',
    livePhotoVideoId: null,
    people: [],
    checksum: row.checksum,
    isOffline: false,
    hasMetadata: true,
    duplicateId: null,
    resized: true,
    exifInfo: {
      fileSizeInByte: Number(row.size || 0),
      dateTimeOriginal: row.file_created_at,
      modifyDate: row.file_modified_at,
    },
  };
}

// Reconcile any photos uploaded via CloudVault UI or WebDAV into immich_assets so the mobile app sees everything
async function syncUserPhotosBucketToIndex(userId) {
  const bucket = getUserPhotosBucket(userId);
  if (!bucket) return [];

  try {
    const channelData = await telegramService.getChannelFiles(bucket.channel_id, bucket.access_hash, bucket.id, 1, 200);
    const existingRows = db.prepare('SELECT msg_id FROM immich_assets WHERE user_id = ? AND bucket_id = ?').all(userId, bucket.id);
    const knownMsgs = new Set(existingRows.map((r) => String(r.msg_id)));

    const favRows = db.prepare('SELECT msg_id FROM photo_meta WHERE user_id = ? AND bucket_id = ? AND is_favorite = 1').all(userId, bucket.id);
    const favSet = new Set(favRows.map((r) => String(r.msg_id)));

    const insertStmt = db.prepare(
      `INSERT OR IGNORE INTO immich_assets
       (id, user_id, bucket_id, msg_id, device_asset_id, device_id, checksum, file_name, mime_type, type, size, is_favorite, file_created_at, file_modified_at)
       VALUES (?, ?, ?, ?, ?, 'cloudvault', ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const f of channelData.files) {
      if (knownMsgs.has(String(f.msg_id))) continue;
      const mimeType = f.mime_type || mime.lookup(f.file_name) || 'application/octet-stream';
      const isVideo = f.type === 'video' || mimeType.startsWith('video/') || VIDEO_EXT.test(f.file_name || '');
      const isImage = f.type === 'photo' || mimeType.startsWith('image/');
      if (!isVideo && !isImage) continue;

      const id = assetUuid(bucket.id, f.msg_id);
      const ts = isoDate(f.date);
      const fallbackChecksum = crypto.createHash('sha1').update(`${bucket.id}:${f.msg_id}:${f.file_name}`).digest('base64');
      insertStmt.run(
        id,
        userId,
        bucket.id,
        String(f.msg_id),
        id,
        fallbackChecksum,
        f.file_name || `media_${f.msg_id}`,
        mimeType,
        isVideo ? 'VIDEO' : 'IMAGE',
        Number(f.size || 0),
        favSet.has(String(f.msg_id)) ? 1 : 0,
        ts,
        ts
      );
    }
  } catch (err) {
    console.warn('[Immich API] Sync index notice:', err.message);
  }

  return db
    .prepare('SELECT * FROM immich_assets WHERE user_id = ? ORDER BY file_created_at DESC')
    .all(userId);
}

// ==========================================
// 1. Public Server Discovery & Handshake
// ==========================================
router.get('/server/ping', (_req, res) => res.json({ res: 'pong' }));
router.get('/server/version', (_req, res) => res.json(IMMICH_VERSION));
router.get('/server/version-history', (_req, res) =>
  res.json([{ id: deterministicUuid('ver', IMMICH_VERSION_STR), version: IMMICH_VERSION_STR, createdAt: new Date().toISOString() }])
);
router.get('/server/theme', (_req, res) => res.json({ customCss: '' }));

const serverFeatures = {
  smartSearch: false,
  facialRecognition: false,
  duplicateDetection: false,
  map: false,
  backups: false,
  reverseGeocoding: false,
  importFaces: false,
  sidecar: false,
  search: true,
  trash: false,
  oauth: false,
  oauthAutoLaunch: false,
  ocr: false,
  passwordLogin: true,
  configFile: false,
  email: false,
  realtimeTranscoding: false,
};

const serverConfig = {
  loginPageMessage: '',
  trashDays: 30,
  userDeleteDelay: 7,
  oauthButtonText: 'Login with OAuth',
  oauthAccountManagementUrl: null,
  isInitialized: true,
  isOnboarded: true,
  externalDomain: '',
  publicUsers: false,
  mapDarkStyleUrl: '',
  mapLightStyleUrl: '',
  maintenanceMode: false,
  minFaces: 3,
};

router.get('/server/features', (_req, res) => res.json(serverFeatures));
router.get('/server/config', (_req, res) => res.json(serverConfig));
router.get('/public/config', (_req, res) => res.json({ ...serverConfig, features: serverFeatures }));
router.get('/public/config/defaults', (_req, res) => res.json({ ...serverConfig, features: serverFeatures }));
router.get('/server/about', (_req, res) =>
  res.json({ version: IMMICH_VERSION_STR, versionUrl: '', licensed: false })
);
router.get('/server/media-types', (_req, res) =>
  res.json({
    video: ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.3gp'],
    image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.avif', '.bmp', '.tif', '.tiff'],
    sidecar: ['.xmp'],
  })
);
router.get('/server/storage', immichAuth, (_req, res) =>
  res.json({
    diskSize: '1 TB',
    diskUse: '0 B',
    diskAvailable: '1 TB',
    diskSizeRaw: 1099511627776,
    diskUseRaw: 0,
    diskAvailableRaw: 1099511627776,
    diskUsagePercentage: 0,
  })
);

// ==========================================
// 2. Authentication & User Profile
// ==========================================
router.post('/auth/login', (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(401).json({ message: 'Invalid login credentials', error: 'Unauthorized', statusCode: 401 });
    }

    const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email);
    if (!user || user.status === 'suspended' || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ message: 'Invalid login credentials', error: 'Unauthorized', statusCode: 401 });
    }

    const plain = generateToken();
    const hashed = hashToken(plain);
    const ins = db
      .prepare(
        `INSERT INTO personal_access_tokens (tokenable_type, tokenable_id, name, token, created_at, updated_at)
         VALUES ('App\\\\Models\\\\User', ?, 'immich_mobile', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run(user.id, hashed);

    const accessToken = `${ins.lastInsertRowid}|${plain}`;
    db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    res.setHeader('Set-Cookie', [
      `immich_access_token=${encodeURIComponent(accessToken)}; Path=/; HttpOnly; SameSite=Lax`,
      'immich_auth_type=password; Path=/; HttpOnly; SameSite=Lax',
      'immich_is_authenticated=true; Path=/; SameSite=Lax',
    ]);

    return res.status(201).json({
      accessToken,
      userId: userUuid(user.id),
      userEmail: user.email,
      name: user.name || user.email.split('@')[0],
      profileImagePath: '',
      isAdmin: user.role === 'admin',
      shouldChangePassword: false,
      isOnboarded: true,
    });
  } catch (err) {
    console.error('[Immich API] Login error:', err);
    return res.status(500).json({ message: 'Internal server error', statusCode: 500 });
  }
});

router.post('/auth/validateToken', immichAuth, (_req, res) => res.status(200).json({ authStatus: true }));
router.get('/auth/status', immichAuth, (_req, res) => res.json({ password: true, pinCode: false, isElevated: false }));
router.post('/auth/logout', immichAuth, (_req, res) => res.status(200).json({ successful: true, redirectUri: '/auth/login' }));

router.get('/users/me', immichAuth, (req, res) => res.json(mapImmichUser(req.user)));
router.get('/users/me/preferences', immichAuth, (_req, res) =>
  res.json({
    download: { archiveSize: 4294967296, includeEmbeddedVideos: false },
    folders: { enabled: false, sidebarWeb: false },
    memories: { enabled: false },
    people: { enabled: false, sidebarWeb: false },
    purchase: { hideBuyButtonUntil: null, showSupportBadge: false },
    ratings: { enabled: false },
    sharedLinks: { enabled: true, sidebarWeb: false },
    tags: { enabled: false, sidebarWeb: false },
    cast: { gCastEnabled: false },
  })
);
router.put('/users/me/preferences', immichAuth, (req, res) => res.json(req.body || {}));
router.get('/users', immichAuth, (req, res) => res.json([mapImmichUser(req.user)]));
router.get('/sessions', immichAuth, (_req, res) => res.json([]));
router.get('/albums', immichAuth, (_req, res) => res.json([]));
router.get('/memories', immichAuth, (_req, res) => res.json([]));
router.get('/partners', immichAuth, (_req, res) => res.json([]));
router.get('/people', immichAuth, (_req, res) => res.json({ people: [], total: 0, visible: 0, hidden: 0, hasNextPage: false }));
router.get('/notifications', immichAuth, (_req, res) => res.json([]));
router.get('/tags', immichAuth, (_req, res) => res.json([]));
router.get('/stacks', immichAuth, (_req, res) => res.json([]));
router.get('/shared-links', immichAuth, (_req, res) => res.json([]));

// ==========================================
// 3. Mobile Sync Stream (NDJSON) & Legacy Timeline
// ==========================================
router.get('/sync/ack', immichAuth, (req, res) => {
  const rows = db.prepare('SELECT entity_type as type, ack FROM immich_sync_acks WHERE token_key = ?').all(req.immichTokenKey);
  return res.json(rows);
});

router.post('/sync/ack', immichAuth, (req, res) => {
  const acks = Array.isArray(req.body?.acks) ? req.body.acks : [];
  const upsert = db.prepare(
    `INSERT INTO immich_sync_acks (token_key, entity_type, ack, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(token_key, entity_type) DO UPDATE SET ack = excluded.ack, updated_at = CURRENT_TIMESTAMP`
  );
  for (const ack of acks) {
    const [type] = String(ack).split('|');
    if (type === 'SyncResetV1') {
      db.prepare('DELETE FROM immich_sync_acks WHERE token_key = ?').run(req.immichTokenKey);
    } else if (type) {
      upsert.run(req.immichTokenKey, type, String(ack));
    }
  }
  return res.status(204).end();
});

router.delete('/sync/ack', immichAuth, (req, res) => {
  const types = Array.isArray(req.body?.types) ? req.body.types : [];
  if (types.length === 0) {
    db.prepare('DELETE FROM immich_sync_acks WHERE token_key = ?').run(req.immichTokenKey);
  } else {
    const del = db.prepare('DELETE FROM immich_sync_acks WHERE token_key = ? AND entity_type = ?');
    for (const t of types) del.run(req.immichTokenKey, String(t));
  }
  return res.status(204).end();
});

router.post('/sync/stream', immichAuth, async (req, res) => {
  try {
    const types = Array.isArray(req.body?.types) ? req.body.types : [];
    const reset = Boolean(req.body?.reset);
    if (reset) {
      db.prepare('DELETE FROM immich_sync_acks WHERE token_key = ?').run(req.immichTokenKey);
    }

    res.setHeader('Content-Type', 'application/jsonlines+json');
    res.status(200);

    const writeLine = (type, data, id) => {
      res.write(JSON.stringify({ type, data, ack: `${type}|${id}` }) + '\n');
    };

    const u = mapImmichUser(req.user);

    if (types.includes('AuthUsersV2') || types.includes('AuthUsersV1')) {
      const entityType = types.includes('AuthUsersV2') ? 'AuthUserV2' : 'AuthUserV1';
      writeLine(
        entityType,
        {
          id: u.id,
          name: u.name,
          email: u.email,
          avatarColor: u.avatarColor,
          deletedAt: null,
          hasProfileImage: false,
          profileChangedAt: u.profileChangedAt,
          isAdmin: u.isAdmin,
          pinCode: null,
          oauthId: entityType === 'AuthUserV2' ? null : '',
          storageLabel: null,
          quotaSizeInBytes: null,
          quotaUsageInBytes: u.quotaUsageInBytes,
        },
        u.id
      );
    }

    if (types.includes('UsersV1')) {
      writeLine(
        'UserV1',
        {
          id: u.id,
          name: u.name,
          email: u.email,
          avatarColor: u.avatarColor,
          deletedAt: null,
          hasProfileImage: false,
          profileChangedAt: u.profileChangedAt,
        },
        u.id
      );
    }

    if (types.includes('AssetsV2') || types.includes('AssetsV1')) {
      const entityType = types.includes('AssetsV2') ? 'AssetV2' : 'AssetV1';
      const assets = await syncUserPhotosBucketToIndex(req.user.id);
      for (const a of assets) {
        writeLine(
          entityType,
          {
            id: a.id,
            ownerId: u.id,
            originalFileName: a.file_name,
            thumbhash: null,
            checksum: a.checksum,
            fileCreatedAt: a.file_created_at,
            fileModifiedAt: a.file_modified_at,
            createdAt: isoDate(a.created_at),
            localDateTime: a.file_created_at,
            duration: entityType === 'AssetV2' ? 0 : (a.duration || '0:00:00.00000'),
            type: a.type === 'VIDEO' ? 'VIDEO' : 'IMAGE',
            deletedAt: null,
            isFavorite: Boolean(a.is_favorite),
            visibility: 'timeline',
            livePhotoVideoId: null,
            stackId: null,
            libraryId: null,
            width: null,
            height: null,
            isEdited: false,
          },
          a.id
        );
      }
    }

    writeLine('SyncCompleteV1', {}, 'complete');
    return res.end();
  } catch (err) {
    console.error('[Immich API] Sync stream error:', err);
    if (!res.headersSent) return res.status(500).json({ message: 'Sync failed' });
    return res.end();
  }
});

// Legacy timeline endpoints (for older Immich app versions)
router.get('/timeline/buckets', immichAuth, async (req, res) => {
  const assets = await syncUserPhotosBucketToIndex(req.user.id);
  const counts = new Map();
  for (const a of assets) {
    const month = `${String(a.file_created_at).slice(0, 7)}-01T00:00:00.000Z`;
    counts.set(month, (counts.get(month) || 0) + 1);
  }
  const buckets = Array.from(counts.entries()).map(([timeBucket, count]) => ({ timeBucket, count }));
  return res.json(buckets);
});

router.get('/timeline/bucket', immichAuth, async (req, res) => {
  const tb = String(req.query.timeBucket || '').slice(0, 7);
  const assets = (await syncUserPhotosBucketToIndex(req.user.id)).filter(
    (a) => !tb || String(a.file_created_at).startsWith(tb)
  );
  return res.json({
    id: assets.map((a) => a.id),
    city: assets.map(() => null),
    country: assets.map(() => null),
    duration: assets.map((a) => a.duration || '0:00:00.00000'),
    fileCreatedAt: assets.map((a) => a.file_created_at),
    isFavorite: assets.map((a) => Boolean(a.is_favorite)),
    isImage: assets.map((a) => a.type !== 'VIDEO'),
    isTrashed: assets.map(() => false),
    livePhotoVideoId: assets.map(() => null),
    localOffsetHours: assets.map(() => 0),
    ownerId: assets.map((a) => userUuid(a.user_id)),
    projectionType: assets.map(() => null),
    ratio: assets.map(() => 1),
    stack: assets.map(() => null),
    thumbhash: assets.map(() => null),
    visibility: assets.map(() => 'timeline'),
  });
});

// ==========================================
// 4. Asset Deduplication, Upload, Viewing & Delete
// ==========================================
router.get('/assets/device/:deviceId', immichAuth, (req, res) => {
  const rows = db
    .prepare('SELECT device_asset_id FROM immich_assets WHERE user_id = ? AND device_id = ? AND device_asset_id IS NOT NULL')
    .all(req.user.id, String(req.params.deviceId));
  return res.json(rows.map((r) => r.device_asset_id));
});

router.post('/assets/exist', immichAuth, (req, res) => {
  const deviceId = String(req.body?.deviceId || '');
  const ids = Array.isArray(req.body?.deviceAssetIds) ? req.body.deviceAssetIds : [];
  if (!deviceId || ids.length === 0) return res.json({ existingIds: [] });
  const existing = db
    .prepare('SELECT device_asset_id FROM immich_assets WHERE user_id = ? AND device_id = ?')
    .all(req.user.id, deviceId);
  const set = new Set(existing.map((r) => r.device_asset_id));
  return res.json({ existingIds: ids.filter((id) => set.has(id)) });
});

router.post('/assets/bulk-upload-check', immichAuth, (req, res) => {
  const assets = Array.isArray(req.body?.assets) ? req.body.assets : [];
  const rows = db.prepare('SELECT id, checksum FROM immich_assets WHERE user_id = ?').all(req.user.id);
  const byChecksum = new Map(rows.map((r) => [r.checksum, r.id]));

  const results = assets.map((item) => {
    const norm = normalizeChecksum(item.checksum);
    const existingId = byChecksum.get(norm);
    if (existingId) {
      return { id: item.id, action: 'reject', reason: 'duplicate', assetId: existingId, isTrashed: false };
    }
    return { id: item.id, action: 'accept' };
  });

  return res.status(200).json({ results });
});

router.get('/assets/statistics', immichAuth, (req, res) => {
  const rows = db.prepare('SELECT type, COUNT(*) as c FROM immich_assets WHERE user_id = ? GROUP BY type').all(req.user.id);
  let images = 0;
  let videos = 0;
  for (const r of rows) {
    if (r.type === 'VIDEO') videos += r.c;
    else images += r.c;
  }
  return res.json({ images, videos, total: images + videos });
});

// Upload from Immich mobile app -> directly into user's dedicated hidden Photos bucket
router.post('/assets', immichAuth, flexibleUpload, async (req, res) => {
  const files = req.files || (req.file ? [req.file] : []);
  const file = files.find((f) => f.fieldname === 'assetData') || files[0];
  if (!file) {
    return res.status(400).json({ message: 'assetData file is required', statusCode: 400 });
  }

  try {
    const checksum = normalizeChecksum(req.headers['x-immich-checksum']) || (await sha1Base64File(file.path));
    const existing = db.prepare('SELECT id FROM immich_assets WHERE user_id = ? AND checksum = ?').get(req.user.id, checksum);
    if (existing) {
      return res.status(200).json({ id: existing.id, status: 'duplicate' });
    }

    const bucket = await ensureUserPhotosBucket(req.user.id, req.user.name || req.user.email);
    const originalFileName = path.basename(req.body?.filename || file.originalname || 'asset.jpg');
    const uploaded = await telegramService.uploadFileToChannel(
      bucket.channel_id,
      bucket.access_hash,
      file.path,
      originalFileName
    );
    if (!uploaded || !uploaded.id) {
      throw new Error('Cloud storage upload failed.');
    }

    const encMsgId = safeEncryptId(uploaded.id, bucket.id);
    const id = assetUuid(bucket.id, encMsgId);
    const mimeType = file.mimetype || mime.lookup(originalFileName) || 'application/octet-stream';
    const type = mimeType.startsWith('video/') || VIDEO_EXT.test(originalFileName) ? 'VIDEO' : 'IMAGE';
    const fileCreatedAt = isoDate(req.body?.fileCreatedAt);
    const fileModifiedAt = isoDate(req.body?.fileModifiedAt || req.body?.fileCreatedAt);
    const isFav = req.body?.isFavorite === true || req.body?.isFavorite === 'true' ? 1 : 0;

    db.prepare(
      `INSERT OR REPLACE INTO immich_assets
       (id, user_id, bucket_id, msg_id, device_asset_id, device_id, checksum, file_name, mime_type, type, size, duration, is_favorite, file_created_at, file_modified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(
      id,
      req.user.id,
      bucket.id,
      encMsgId,
      req.body?.deviceAssetId || id,
      req.body?.deviceId || 'mobile',
      checksum,
      originalFileName,
      mimeType,
      type,
      file.size || 0,
      req.body?.duration || null,
      isFav,
      fileCreatedAt,
      fileModifiedAt
    );

    if (isFav) {
      db.prepare(
        `INSERT INTO photo_meta (user_id, bucket_id, msg_id, is_favorite, updated_at)
         VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, bucket_id, msg_id) DO UPDATE SET is_favorite = 1, updated_at = CURRENT_TIMESTAMP`
      ).run(req.user.id, bucket.id, encMsgId);
    }

    return res.status(201).json({ id, status: 'created' });
  } catch (err) {
    console.error('[Immich API] Asset upload error:', err);
    return res.status(500).json({ message: 'Failed to upload asset', statusCode: 500 });
  } finally {
    for (const f of files) {
      try { if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (_) {}
    }
  }
});

router.get('/assets/:id/thumbnail', immichAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM immich_assets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).end();
  const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(row.bucket_id);
  if (!bucket) return res.status(404).end();
  const msgId = safeDecryptId(row.msg_id, bucket.id);
  if (!msgId) return res.status(404).end();
  return telegramService.streamThumbnail(bucket.channel_id, bucket.access_hash, msgId, req, res, bucket.id, row.msg_id);
});

router.get('/assets/:id/original', immichAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM immich_assets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).end();
  const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(row.bucket_id);
  if (!bucket) return res.status(404).end();
  const msgId = safeDecryptId(row.msg_id, bucket.id);
  if (!msgId) return res.status(404).end();
  return telegramService.streamMedia(bucket.channel_id, bucket.access_hash, msgId, req, res, false);
});

router.get('/assets/:id/video/playback', immichAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM immich_assets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).end();
  const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(row.bucket_id);
  if (!bucket) return res.status(404).end();
  const msgId = safeDecryptId(row.msg_id, bucket.id);
  if (!msgId) return res.status(404).end();
  return telegramService.streamMedia(bucket.channel_id, bucket.access_hash, msgId, req, res, false);
});

router.get('/assets/:id', immichAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM immich_assets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ message: 'Asset not found', statusCode: 404 });
  return res.json(mapAssetResponse(row));
});

function updateAssetFavorite(userId, ids, isFavorite) {
  const favVal = isFavorite ? 1 : 0;
  for (const id of ids) {
    const row = db.prepare('SELECT * FROM immich_assets WHERE id = ? AND user_id = ?').get(id, userId);
    if (!row) continue;
    db.prepare('UPDATE immich_assets SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(favVal, row.id);
    db.prepare(
      `INSERT INTO photo_meta (user_id, bucket_id, msg_id, is_favorite, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, bucket_id, msg_id) DO UPDATE SET is_favorite = excluded.is_favorite, updated_at = CURRENT_TIMESTAMP`
    ).run(userId, row.bucket_id, row.msg_id, favVal);
  }
}

router.put('/assets/:id', immichAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM immich_assets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ message: 'Asset not found', statusCode: 404 });
  if (typeof req.body?.isFavorite === 'boolean') {
    updateAssetFavorite(req.user.id, [row.id], req.body.isFavorite);
  }
  const updated = db.prepare('SELECT * FROM immich_assets WHERE id = ?').get(row.id);
  return res.json(mapAssetResponse(updated));
});

const handleBulkUpdate = (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (typeof req.body?.isFavorite === 'boolean' && ids.length > 0) {
    updateAssetFavorite(req.user.id, ids, req.body.isFavorite);
  }
  return res.status(204).end();
};
router.put('/assets', immichAuth, handleBulkUpdate);
router.patch('/assets', immichAuth, handleBulkUpdate);

router.delete('/assets', immichAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const byBucket = new Map();

    for (const id of ids) {
      const row = db.prepare('SELECT * FROM immich_assets WHERE id = ? AND user_id = ?').get(id, req.user.id);
      if (!row) continue;
      if (!byBucket.has(row.bucket_id)) byBucket.set(row.bucket_id, []);
      byBucket.get(row.bucket_id).push(row);
    }

    for (const [bucketId, rows] of byBucket.entries()) {
      const bucket = db.prepare('SELECT * FROM buckets WHERE id = ?').get(bucketId);
      const rawMsgIds = [];
      for (const r of rows) {
        const dec = safeDecryptId(r.msg_id, bucketId);
        if (dec) rawMsgIds.push(dec);
        db.prepare('DELETE FROM immich_assets WHERE id = ?').run(r.id);
        db.prepare('DELETE FROM photo_meta WHERE user_id = ? AND bucket_id = ? AND msg_id = ?').run(req.user.id, bucketId, r.msg_id);
      }
      if (bucket && rawMsgIds.length > 0) {
        await telegramService.deleteMessages(bucket.channel_id, bucket.access_hash, rawMsgIds);
      }
    }

    return res.status(204).end();
  } catch (err) {
    console.error('[Immich API] Delete assets error:', err);
    return res.status(500).json({ message: 'Delete failed', statusCode: 500 });
  }
});

module.exports = router;
