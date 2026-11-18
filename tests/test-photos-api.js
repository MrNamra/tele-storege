const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_FILE = path.join(os.tmpdir(), `tele_photos_test_${Date.now()}.sqlite`);
process.env.APP_KEY = 'base64:photos-api-test-key-32-bytes-long=';
process.env.IMMICH_BRIDGE_SECRET = 'shared-immich-secret-456';

const telegramService = require('../services/telegramService');
const { safeEncryptId } = require('../utils/crypto');

const mockChannels = new Map();
let nextChan = 2000;
let nextMsgId = 100;

telegramService.createPrivateChannel = async (name) => {
  const ch = { channel_id: `-100${nextChan++}`, access_hash: '111', title: name };
  mockChannels.set(ch.channel_id, []);
  return ch;
};

telegramService.uploadFileToChannel = async (channelId, _hash, _filePath, fileName) => {
  const id = nextMsgId++;
  const arr = mockChannels.get(channelId) || [];
  arr.push({ raw_id: id, file_name: fileName, mime_type: 'image/jpeg', type: 'photo', size: 1234, date: Math.floor(Date.now() / 1000) });
  mockChannels.set(channelId, arr);
  return { id };
};

telegramService.getChannelFiles = async (channelId, _hash, bucketId) => {
  const items = (mockChannels.get(channelId) || []).map((m) => ({
    ...m,
    msg_id: safeEncryptId(m.raw_id, bucketId),
    thumbnail: `/t/${bucketId}/${safeEncryptId(m.raw_id, bucketId)}`,
    stream_url: `/s/${bucketId}/${safeEncryptId(m.raw_id, bucketId)}`,
  }));
  return { files: items, pagination: { currentPage: 1, perPage: 100, totalFiles: items.length, totalPages: 1 }, totalStorage: 1 };
};

telegramService.deleteMessages = async (channelId, _hash, ids) => {
  const cur = mockChannels.get(channelId) || [];
  mockChannels.set(channelId, cur.filter((m) => !ids.includes(m.raw_id)));
};

const app = require('../app');
const db = require('../config/db');

function reqRaw(port, method, reqPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks).toString('utf8') }));
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
  return { status: r.status, body: JSON.parse(r.raw || '{}') };
}

(async () => {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();

  try {
    // 1. Register Alice & Bob
    const regA = await reqJson(port, 'POST', '/api/register', { name: 'Alice', email: 'alice@test.local', password: 'password123' });
    const regB = await reqJson(port, 'POST', '/api/register', { name: 'Bob', email: 'bob@test.local', password: 'password123' });
    const tokA = regA.body.data.token;
    const tokB = regB.body.data.token;

    // 2. Alice creates a regular Drive ("Work") and puts a photo in it
    const workDrive = await reqJson(port, 'POST', '/api/bucket/create', { name: 'Work' }, tokA);
    assert.strictEqual(workDrive.status, 200);
    mockChannels.set(workDrive.body.data.channel_id, [
      { raw_id: 1, file_name: 'work_doc_photo.jpg', mime_type: 'image/jpeg', type: 'photo', size: 5000, date: 1731999999 },
    ]);

    // 3. Ensure Alice's dedicated Photos bucket
    const ens = await reqJson(port, 'POST', '/api/photos/ensure-default-bucket', {}, tokA);
    assert.strictEqual(ens.status, 200);
    const photosBucketId = ens.body.bucket.id;
    assert.strictEqual(ens.body.bucket.kind, 'photos');
    assert.notStrictEqual(photosBucketId, workDrive.body.data.id, 'Photos must be a separate group from normal drives');

    // 4. Dedicated Photos bucket MUST NOT show in Drives list or Dashboard
    const listRes = await reqJson(port, 'GET', '/api/bucket/list', null, tokA);
    assert.strictEqual(listRes.body.data.length, 1, 'only regular Work drive appears in /api/bucket/list');
    assert.strictEqual(listRes.body.data[0].bucketName, 'Work');

    const dashRes = await reqJson(port, 'GET', '/api/user/dashboard', null, tokA);
    assert.strictEqual(dashRes.body.data.bucket.length, 1, 'only regular Work drive appears in dashboard');
    assert.strictEqual(dashRes.body.data.bucket[0].bucketName, 'Work');

    // Cannot delete Photos bucket via regular drive delete API
    const delDriveAttempt = await reqJson(port, 'POST', `/api/bucket/delete/${photosBucketId}`, {}, tokA);
    assert.strictEqual(delDriveAttempt.status, 404, 'Photos bucket cannot be deleted via drive API');

    // 5. Dedicated Photos bucket MUST show in WebDAV PROPFIND /webdav/ and be protected from folder delete
    const basicAuth = 'basic ' + Buffer.from('Alice@Test.Local:password123').toString('base64');
    const davProp = await reqRaw(port, 'PROPFIND', '/webdav/', { Authorization: basicAuth, Depth: '1' });
    assert.strictEqual(davProp.status, 207);
    assert.ok(davProp.raw.includes('/webdav/Photos/'), 'Photos folder must appear in WebDAV');
    assert.ok(davProp.raw.includes('/webdav/Work/'), 'Work drive must also appear in WebDAV');

    // Direct /webdav/Photos/ access for a brand-new user (Bob) auto-creates his Photos folder
    const bobBasic = 'Basic ' + Buffer.from('Bob@Test.Local:password123').toString('base64');
    const bobDirectPhotos = await reqRaw(port, 'PROPFIND', '/webdav/Photos/', { Authorization: bobBasic, Depth: '1' });
    assert.strictEqual(bobDirectPhotos.status, 207, 'Direct /webdav/Photos/ must auto-initialize and return 207');

    const davDelPhotos = await reqRaw(port, 'DELETE', '/webdav/Photos', { Authorization: basicAuth });
    assert.strictEqual(davDelPhotos.status, 403, 'Photos folder cannot be deleted from WebDAV');

    // 6. Immich bridge uploads for alice@test.local MUST go into the EXACT SAME Photos bucket
    const sample = Buffer.from('immich-app-photo-bytes');
    const immichUp = await reqRaw(
      port,
      'POST',
      '/api/immich/upload',
      {
        'x-immich-secret': process.env.IMMICH_BRIDGE_SECRET,
        'x-owner-id': 'immich-uuid-alice',
        'x-owner-email': encodeURIComponent('alice@test.local'),
        'x-owner-name': encodeURIComponent('Alice'),
        'x-file-name': encodeURIComponent('from_immich_app.jpg'),
        'content-length': sample.length,
      },
      sample
    );
    assert.strictEqual(immichUp.status, 200);
    const immichJson = JSON.parse(immichUp.raw);
    assert.strictEqual(String(immichJson.bucketId), String(photosBucketId), 'Immich must share the exact same Photos bucket');

    // 7. Timeline returns ONLY Photos bucket media (includes Immich upload, excludes Work drive photo!)
    const tl = await reqJson(port, 'GET', '/api/photos/timeline', null, tokA);
    assert.strictEqual(tl.status, 200);
    assert.strictEqual(tl.body.data.length, 1, 'timeline must NOT include regular Work drive files');
    assert.strictEqual(tl.body.data[0].file_name, 'from_immich_app.jpg');

    // 8. Favorite + cross-user isolation + delete
    const photoItem = tl.body.data[0];
    const fav = await reqJson(port, 'POST', '/api/photos/favorite', { bucket_id: photoItem.bucket_id, msg_id: photoItem.msg_id }, tokA);
    assert.strictEqual(fav.body.is_favorite, true);

    const bobFav = await reqJson(port, 'POST', '/api/photos/favorite', { bucket_id: photoItem.bucket_id, msg_id: photoItem.msg_id }, tokB);
    assert.strictEqual(bobFav.status, 404);

    const aliceDel = await reqJson(port, 'POST', '/api/photos/delete', { items: [{ bucket_id: photoItem.bucket_id, msg_id: photoItem.msg_id }] }, tokA);
    assert.strictEqual(aliceDel.body.deleted, 1);

    console.log('✓ All separated Photos bucket + hidden-from-drives + WebDAV + Immich integration tests passed!');
  } finally {
    server.close();
    try { db.close(); } catch {}
    for (const suffix of ['', '-wal', '-shm']) {
      try { if (fs.existsSync(process.env.DB_FILE + suffix)) fs.unlinkSync(process.env.DB_FILE + suffix); } catch {}
    }
  }
})();
