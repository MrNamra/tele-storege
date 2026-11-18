const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Point DB to a disposable temp SQLite file before loading app
process.env.DB_FILE = path.join(os.tmpdir(), `tele_immich_test_${Date.now()}.sqlite`);
process.env.IMMICH_BRIDGE_SECRET = 'test-bridge-secret-123';
process.env.APP_KEY = 'base64:test-app-key-for-immich-bridge-32b=';

// Stub telegramService methods so we can verify bridge routing, auth, per-user isolation, and range streaming offline
const telegramService = require('../services/telegramService');
const uploadedFiles = new Map();
let nextChannel = 1001;
let nextMsg = 500;

telegramService.createPrivateChannel = async (title) => ({
  channel_id: `-100${nextChannel++}`,
  access_hash: '999999',
  title,
});

telegramService.uploadFileToChannel = async (channelId, _accessHash, filePath, fileName) => {
  const id = nextMsg++;
  uploadedFiles.set(`${channelId}:${id}`, { buf: fs.readFileSync(filePath), fileName });
  return { id };
};

telegramService.streamMedia = async (channelId, _accessHash, msgId, req, res) => {
  const item = uploadedFiles.get(`${channelId}:${msgId}`);
  if (!item) return res.status(404).end();
  const range = req.headers.range;
  if (range) {
    const [, startStr, endStr] = /bytes=(\d+)-(\d*)/.exec(range) || [];
    const start = Number(startStr || 0);
    const end = endStr ? Number(endStr) : item.buf.length - 1;
    const chunk = item.buf.subarray(start, end + 1);
    res.writeHead(206, {
      'Content-Type': 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${item.buf.length}`,
      'Content-Length': chunk.length,
      'Accept-Ranges': 'bytes',
    });
    return res.end(chunk);
  }
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': item.buf.length,
    'Accept-Ranges': 'bytes',
  });
  return res.end(item.buf);
};

telegramService.deleteMessages = async (channelId, _accessHash, msgIds) => {
  for (const id of msgIds) uploadedFiles.delete(`${channelId}:${id}`);
};

const app = require('../app');

function sendReq(port, options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, ...options }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();

  try {
    // 1. Rejects missing/invalid secret
    const unauth = await sendReq(port, { method: 'POST', path: '/api/immich/upload' }, Buffer.from('abc'));
    assert.strictEqual(unauth.status, 401, 'must reject unauthenticated requests');

    // 2. Uploads user A file -> creates bucket A
    const sample = Buffer.from('hello-immich-telegram-original-bytes');
    const upA1 = await sendReq(
      port,
      {
        method: 'POST',
        path: '/api/immich/upload',
        headers: {
          'x-immich-secret': process.env.IMMICH_BRIDGE_SECRET,
          'x-owner-id': 'user-uuid-a',
          'x-owner-email': encodeURIComponent('alice@example.com'),
          'x-owner-name': encodeURIComponent('Alice'),
          'x-file-name': encodeURIComponent('IMG_0001.jpg'),
          'content-length': sample.length,
        },
      },
      sample
    );
    assert.strictEqual(upA1.status, 200);
    const metaA1 = JSON.parse(upA1.body.toString());
    assert.strictEqual(metaA1.status, true);
    assert.ok(metaA1.bucketId && metaA1.msgId);

    // 3. Second upload for user A reuses same bucket; user B gets a separate bucket
    const upA2 = await sendReq(
      port,
      {
        method: 'POST',
        path: '/api/immich/upload',
        headers: {
          'x-immich-secret': process.env.IMMICH_BRIDGE_SECRET,
          'x-owner-id': 'user-uuid-a',
          'x-file-name': encodeURIComponent('IMG_0002.jpg'),
          'content-length': sample.length,
        },
      },
      sample
    );
    const metaA2 = JSON.parse(upA2.body.toString());
    assert.strictEqual(metaA2.bucketId, metaA1.bucketId, 'same user must reuse same Telegram channel bucket');

    const upB1 = await sendReq(
      port,
      {
        method: 'POST',
        path: '/api/immich/upload',
        headers: {
          'x-immich-secret': process.env.IMMICH_BRIDGE_SECRET,
          'x-owner-id': 'user-uuid-b',
          'x-owner-email': encodeURIComponent('bob@example.com'),
          'x-owner-name': encodeURIComponent('Bob'),
          'x-file-name': encodeURIComponent('VID_0001.mp4'),
          'content-length': sample.length,
        },
      },
      sample
    );
    const metaB1 = JSON.parse(upB1.body.toString());
    assert.notStrictEqual(metaB1.bucketId, metaA1.bucketId, 'different users must get separate Telegram channels');

    // 4. Stream with HTTP 206 Byte Range
    const streamRes = await sendReq(port, {
      method: 'GET',
      path: `/api/immich/stream/${metaA1.bucketId}/${metaA1.msgId}`,
      headers: {
        'x-immich-secret': process.env.IMMICH_BRIDGE_SECRET,
        range: 'bytes=0-4',
      },
    });
    assert.strictEqual(streamRes.status, 206);
    assert.strictEqual(streamRes.body.toString(), 'hello');

    // 5. Delete removes from Telegram
    const delRes = await sendReq(port, {
      method: 'DELETE',
      path: `/api/immich/file/${metaA1.bucketId}/${metaA1.msgId}`,
      headers: { 'x-immich-secret': process.env.IMMICH_BRIDGE_SECRET },
    });
    assert.strictEqual(delRes.status, 200);

    const afterDel = await sendReq(port, {
      method: 'GET',
      path: `/api/immich/stream/${metaA1.bucketId}/${metaA1.msgId}`,
      headers: { 'x-immich-secret': process.env.IMMICH_BRIDGE_SECRET },
    });
    assert.strictEqual(afterDel.status, 404);

    console.log('✓ All Immich <-> tele-storage bridge tests passed!');
  } finally {
    server.close();
    try { fs.unlinkSync(process.env.DB_FILE); } catch {}
  }
})();
