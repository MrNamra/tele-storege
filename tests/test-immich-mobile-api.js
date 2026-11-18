const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

process.env.DB_FILE = path.join(os.tmpdir(), `tele_immich_mobile_test_${Date.now()}.sqlite`);
process.env.APP_KEY = 'base64:immich-mobile-test-key-32-bytes=';

const telegramService = require('../services/telegramService');
const { safeEncryptId } = require('../utils/crypto');

const mockChannels = new Map();
let nextChan = 3000;
let nextMsg = 100;

telegramService.createPrivateChannel = async (name) => {
  const ch = { channel_id: `-100${nextChan++}`, access_hash: '222', title: name };
  mockChannels.set(ch.channel_id, []);
  return ch;
};

telegramService.uploadFileToChannel = async (channelId, _hash, filePath, fileName) => {
  const id = nextMsg++;
  const buf = fs.readFileSync(filePath);
  const arr = mockChannels.get(channelId) || [];
  arr.push({ raw_id: id, file_name: fileName, mime_type: 'image/jpeg', type: 'photo', size: buf.length, date: Math.floor(Date.now() / 1000), buf });
  mockChannels.set(channelId, arr);
  return { id };
};

telegramService.getChannelFiles = async (channelId, _hash, bucketId) => {
  const files = (mockChannels.get(channelId) || []).map((m) => ({
    ...m,
    msg_id: safeEncryptId(m.raw_id, bucketId),
    thumbnail: `/t/${bucketId}/${safeEncryptId(m.raw_id, bucketId)}`,
    stream_url: `/s/${bucketId}/${safeEncryptId(m.raw_id, bucketId)}`,
  }));
  return { files, pagination: { currentPage: 1, perPage: 200, totalFiles: files.length, totalPages: 1 }, totalStorage: 1 };
};

telegramService.streamMedia = async (channelId, _hash, msgId, _req, res) => {
  const item = (mockChannels.get(channelId) || []).find((m) => m.raw_id === msgId);
  if (!item) return res.status(404).end();
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': item.buf.length });
  return res.end(item.buf);
};

telegramService.streamThumbnail = async (channelId, _hash, msgId, _req, res) => {
  const item = (mockChannels.get(channelId) || []).find((m) => m.raw_id === msgId);
  if (!item) return res.status(404).end();
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': item.buf.length });
  return res.end(item.buf);
};

telegramService.deleteMessages = async (channelId, _hash, ids) => {
  mockChannels.set(channelId, (mockChannels.get(channelId) || []).filter((m) => !ids.includes(m.raw_id)));
};

const app = require('../app');
const db = require('../config/db');

function reqRaw(port, method, reqPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function reqJson(port, method, reqPath, body, token) {
  const data = body ? JSON.stringify(body) : null;
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (data) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(data);
  }
  const r = await reqRaw(port, method, reqPath, headers, data);
  return { status: r.status, body: r.buf.length ? JSON.parse(r.buf.toString('utf8')) : null };
}

(async () => {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();

  try {
    // Seed a CloudVault user
    await reqJson(port, 'POST', '/api/register', { name: 'MobileUser', email: 'mobile@test.local', password: 'password123' });

    // 1. Immich app init discovery & handshake (no auth)
    const wk = await reqJson(port, 'GET', '/.well-known/immich');
    assert.strictEqual(wk.status, 200);
    assert.strictEqual(wk.body.api.endpoint, '/api');

    const ping = await reqJson(port, 'GET', '/api/server/ping');
    assert.strictEqual(ping.body.res, 'pong');

    const ver = await reqJson(port, 'GET', '/api/server/version');
    assert.strictEqual(ver.body.major, 2);

    const cfg = await reqJson(port, 'GET', '/api/server/config');
    assert.strictEqual(cfg.body.isInitialized, true);

    // 2. Immich mobile login -> returns UUID userId & accessToken
    const login = await reqJson(port, 'POST', '/api/auth/login', { email: 'Mobile@Test.Local', password: 'password123' });
    assert.strictEqual(login.status, 201);
    const token = login.body.accessToken;
    assert.ok(token);
    assert.match(login.body.userId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // Validate token & user profile
    const val = await reqJson(port, 'POST', '/api/auth/validateToken', {}, token);
    assert.strictEqual(val.body.authStatus, true);

    const me = await reqJson(port, 'GET', '/api/users/me', null, token);
    assert.strictEqual(me.body.email, 'mobile@test.local');

    // 3. Upload photo via Immich mobile multipart POST /api/assets
    const imgBytes = Buffer.from('fake-jpeg-mobile-photo-payload-0123456789');
    const checksum = crypto.createHash('sha1').update(imgBytes).digest('base64');
    const boundary = '----ImmichTestBoundary7MA4YWxkTrZu0gW';
    const mp = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="deviceAssetId"\r\n\r\nphone-001\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="deviceId"\r\n\r\niphone-15\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="fileCreatedAt"\r\n\r\n2026-11-18T10:00:00.000Z\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="fileModifiedAt"\r\n\r\n2026-11-18T10:00:00.000Z\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="assetData"; filename="IMG_1001.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      imgBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const up = await reqRaw(
      port,
      'POST',
      '/api/assets',
      {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': mp.length,
        'x-immich-checksum': checksum,
      },
      mp
    );
    assert.strictEqual(up.status, 201, `Upload failed: ${up.buf.toString()}`);
    const upJson = JSON.parse(up.buf.toString());
    assert.strictEqual(upJson.status, 'created');
    const assetId = upJson.id;

    // 4. Bulk-upload-check detects duplicate
    const check = await reqJson(
      port,
      'POST',
      '/api/assets/bulk-upload-check',
      { assets: [{ id: 'c1', checksum }, { id: 'c2', checksum: 'bmV3ZmlsZQ==' }] },
      token
    );
    assert.strictEqual(check.body.results[0].action, 'reject');
    assert.strictEqual(check.body.results[0].reason, 'duplicate');
    assert.strictEqual(check.body.results[1].action, 'accept');

    // 5. Sync stream returns AuthUserV2, AssetV2, and SyncCompleteV1 (NDJSON)
    const syncRaw = await reqRaw(
      port,
      'POST',
      '/api/sync/stream',
      {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      JSON.stringify({ types: ['AuthUsersV2', 'AssetsV2'] })
    );
    assert.strictEqual(syncRaw.status, 200);
    const lines = syncRaw.buf.toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(lines.some((l) => l.type === 'AuthUserV2'));
    assert.ok(lines.some((l) => l.type === 'AssetV2' && l.data.id === assetId));
    assert.ok(lines.some((l) => l.type === 'SyncCompleteV1'));

    // 6. Original & thumbnail stream back cleanly, and it ALSO appears in CloudVault /api/photos/timeline (hidden from /api/bucket/list!)
    const orig = await reqRaw(port, 'GET', `/api/assets/${assetId}/original`, { Authorization: `Bearer ${token}` });
    assert.strictEqual(orig.status, 200);
    assert.strictEqual(Buffer.compare(orig.buf, imgBytes), 0);

    const cvTimeline = await reqJson(port, 'GET', '/api/photos/timeline', null, token);
    assert.strictEqual(cvTimeline.body.data.length, 1);
    assert.strictEqual(cvTimeline.body.data[0].file_name, 'IMG_1001.jpg');

    const drives = await reqJson(port, 'GET', '/api/bucket/list', null, token);
    assert.strictEqual(drives.body.data.length, 0, 'Photos bucket must remain hidden from Drives');

    // 7. Favorite & delete
    const fav = await reqJson(port, 'PUT', `/api/assets/${assetId}`, { isFavorite: true }, token);
    assert.strictEqual(fav.body.isFavorite, true);

    const del = await reqJson(port, 'DELETE', '/api/assets', { ids: [assetId] }, token);
    assert.strictEqual(del.status, 204);

    const after = await reqJson(port, 'GET', `/api/assets/${assetId}`, null, token);
    assert.strictEqual(after.status, 404);

    console.log('✓ All direct Immich mobile app init, login, upload, sync, stream & delete tests passed!');
  } finally {
    server.close();
    try { db.close(); } catch {}
    for (const suffix of ['', '-wal', '-shm']) {
      try { if (fs.existsSync(process.env.DB_FILE + suffix)) fs.unlinkSync(process.env.DB_FILE + suffix); } catch {}
    }
  }
})();
