const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mime = require('mime-types');
const db = require('../config/db');
const telegramService = require('../services/telegramService');
const { getTmpDir, getAssembledDir, safeMkdirSync } = require('../utils/storagePaths');
const { processNextJob } = require('../services/queueService');
const { safeDecryptId } = require('../utils/crypto');

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseWebdavPath(req) {
  const rawSegments = req.path.split('/').filter(Boolean);
  const segments = rawSegments.map((s) => decodeURIComponent(s).trim());
  return {
    bucketName: segments[0] || null,
    fileName: segments.slice(1).join('/') || null,
  };
}

// HTTP Basic Authentication for WebDAV (Windows Explorer, macOS Finder, Linux GVFS)
function webdavAuth(req, res, next) {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK',
  });

  if (req.method === 'OPTIONS') {
    res.set({
      DAV: '1, 2',
      'MS-Author-Via': 'DAV',
      Allow: 'OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK',
      'Accept-Ranges': 'bytes',
    });
    return res.status(200).end();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Personal Cloud Drive"');
    return res.status(401).send('Authentication required');
  }

  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const colonIndex = credentials.indexOf(':');
    if (colonIndex === -1) {
      res.set('WWW-Authenticate', 'Basic realm="Personal Cloud Drive"');
      return res.status(401).send('Invalid credentials');
    }

    const email = credentials.slice(0, colonIndex).trim();
    const password = credentials.slice(colonIndex + 1);

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || user.status === 'suspended') {
      res.set('WWW-Authenticate', 'Basic realm="Personal Cloud Drive"');
      return res.status(401).send('User not found or suspended');
    }

    const isValid = bcrypt.compareSync(password, user.password);
    if (!isValid) {
      res.set('WWW-Authenticate', 'Basic realm="Personal Cloud Drive"');
      return res.status(401).send('Invalid password');
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('[WebDAV] Auth error:', err);
    res.set('WWW-Authenticate', 'Basic realm="Personal Cloud Drive"');
    return res.status(401).send('Auth error');
  }
}

// Apply authentication to all WebDAV requests
router.use(webdavAuth);

// 1. OPTIONS Handler
router.options('*', (req, res) => {
  res.set({
    DAV: '1, 2',
    'MS-Author-Via': 'DAV',
    Allow: 'OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK',
    'Accept-Ranges': 'bytes',
  });
  return res.status(200).end();
});

// 2. PROPFIND Handler (Directory & File listing for Windows / Mac / Linux)
router.all('*', async (req, res, next) => {
  if (req.method !== 'PROPFIND') return next();

  try {
    const { bucketName, fileName } = parseWebdavPath(req);
    const depth = req.headers['depth'] !== undefined ? req.headers['depth'] : '1';
    const prefix = req.baseUrl || '/webdav';

    let xmlResponses = '';

    // CASE A: Root Directory /webdav/ -> list all user drives/buckets
    if (!bucketName) {
      xmlResponses += `
  <D:response>
    <D:href>${prefix}/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>Personal Cloud Drive</D:displayname>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getlastmodified>${new Date().toUTCString()}</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;

      if (depth !== '0') {
        const buckets = db.prepare('SELECT * FROM buckets WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
        for (const b of buckets) {
          const bHref = `${prefix}/${encodeURIComponent(b.bucketName)}/`;
          xmlResponses += `
  <D:response>
    <D:href>${bHref}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(b.bucketName)}</D:displayname>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getlastmodified>${new Date(b.created_at || Date.now()).toUTCString()}</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
        }
      }
    }
    // CASE B: Inside a Bucket /webdav/BucketName/ -> list files
    else if (bucketName && !fileName) {
      const bucket = db.prepare('SELECT * FROM buckets WHERE user_id = ? AND (bucketName = ? OR id = ?)').get(req.user.id, bucketName, bucketName);
      if (!bucket) {
        return res.status(404).end();
      }

      const bHref = `${prefix}/${encodeURIComponent(bucket.bucketName)}/`;
      xmlResponses += `
  <D:response>
    <D:href>${bHref}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(bucket.bucketName)}</D:displayname>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getlastmodified>${new Date(bucket.created_at || Date.now()).toUTCString()}</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;

      if (depth !== '0') {
        try {
          const channelData = await telegramService.getChannelFiles(
            bucket.channel_id,
            bucket.access_hash,
            bucket.id,
            1,
            1000
          );

          // Merge active uploads from upload_queues so uploaded files appear immediately in drive
          const pendingUploads = db.prepare(
            "SELECT * FROM upload_queues WHERE bucket_id = ? AND status IN ('pending', 'processing', 'uploading_to_cloud') ORDER BY id DESC"
          ).all(bucket.id);

          const fileMap = new Map();
          for (const f of channelData.files) {
            fileMap.set(f.file_name, {
              file_name: f.file_name,
              size: f.size || 0,
              mime_type: f.mime_type || mime.lookup(f.file_name) || 'application/octet-stream',
              date: f.date ? new Date(f.date * 1000).toUTCString() : new Date().toUTCString(),
            });
          }
          for (const p of pendingUploads) {
            fileMap.set(p.file_name, {
              file_name: p.file_name,
              size: p.file_size || 0,
              mime_type: mime.lookup(p.file_name) || 'application/octet-stream',
              date: new Date(p.created_at || Date.now()).toUTCString(),
            });
          }

          for (const f of fileMap.values()) {
            const fHref = `${prefix}/${encodeURIComponent(bucket.bucketName)}/${encodeURIComponent(f.file_name)}`;

            xmlResponses += `
  <D:response>
    <D:href>${fHref}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(f.file_name)}</D:displayname>
        <D:getcontentlength>${f.size || 0}</D:getcontentlength>
        <D:getcontenttype>${escapeXml(f.mime_type)}</D:getcontenttype>
        <D:resourcetype/>
        <D:getlastmodified>${f.date}</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
          }
        } catch (err) {
          console.error('[WebDAV] Error fetching channel files:', err.message);
        }
      }
    }
    // CASE C: Specific File /webdav/BucketName/fileName
    else {
      const bucket = db.prepare('SELECT * FROM buckets WHERE user_id = ? AND (bucketName = ? OR id = ?)').get(req.user.id, bucketName, bucketName);
      if (!bucket) return res.status(404).end();

      const pending = db.prepare(
        "SELECT * FROM upload_queues WHERE bucket_id = ? AND file_name = ? AND status IN ('pending', 'processing', 'uploading_to_cloud') ORDER BY id DESC LIMIT 1"
      ).get(bucket.id, fileName);

      let f = null;
      if (pending) {
        f = {
          file_name: pending.file_name,
          size: pending.file_size || 0,
          mime_type: mime.lookup(pending.file_name) || 'application/octet-stream',
          date: new Date(pending.created_at || Date.now()).toUTCString(),
        };
      } else {
        const channelData = await telegramService.getChannelFiles(bucket.channel_id, bucket.access_hash, bucket.id, 1, 1000);
        const item = channelData.files.find((i) => i.file_name === fileName);
        if (item) {
          f = {
            file_name: item.file_name,
            size: item.size || 0,
            mime_type: item.mime_type || mime.lookup(item.file_name) || 'application/octet-stream',
            date: item.date ? new Date(item.date * 1000).toUTCString() : new Date().toUTCString(),
          };
        }
      }

      if (!f) return res.status(404).end();

      const fHref = `${prefix}/${encodeURIComponent(bucket.bucketName)}/${encodeURIComponent(f.file_name)}`;
      xmlResponses += `
  <D:response>
    <D:href>${fHref}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(f.file_name)}</D:displayname>
        <D:getcontentlength>${f.size || 0}</D:getcontentlength>
        <D:getcontenttype>${escapeXml(f.mime_type)}</D:getcontenttype>
        <D:resourcetype/>
        <D:getlastmodified>${f.date}</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
    }

    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">${xmlResponses}
</D:multistatus>`;

    res.set({
      'Content-Type': 'application/xml; charset="utf-8"',
      DAV: '1, 2',
    });
    return res.status(207).send(xml);
  } catch (error) {
    console.error('[WebDAV] PROPFIND error:', error);
    return res.status(500).end();
  }
});

// 3. GET & HEAD Handler (Stream or download file directly from drive)
router.all('*', async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  try {
    const { bucketName, fileName } = parseWebdavPath(req);
    const prefix = req.baseUrl || '/webdav';

    // If root or bucket collection, show simple HTML index for browser requests
    if (!fileName) {
      const buckets = db.prepare('SELECT * FROM buckets WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
      let listHtml = '';
      if (!bucketName) {
        listHtml = buckets.map((b) => `<li>📁 <a href="${prefix}/${encodeURIComponent(b.bucketName)}/">${escapeXml(b.bucketName)}</a></li>`).join('\n');
      } else {
        const bucket = buckets.find((b) => b.bucketName === bucketName || String(b.id) === bucketName);
        if (!bucket) return res.status(404).send('Drive not found');
        const channelData = await telegramService.getChannelFiles(bucket.channel_id, bucket.access_hash, bucket.id, 1, 1000);
        const pendingUploads = db.prepare(
          "SELECT * FROM upload_queues WHERE bucket_id = ? AND status IN ('pending', 'processing', 'uploading_to_cloud') ORDER BY id DESC"
        ).all(bucket.id);
        const map = new Map();
        for (const f of channelData.files) map.set(f.file_name, f.size);
        for (const p of pendingUploads) map.set(p.file_name, p.file_size);
        listHtml = Array.from(map.entries()).map(([name, size]) => `<li>📄 <a href="${prefix}/${encodeURIComponent(bucket.bucketName)}/${encodeURIComponent(name)}">${escapeXml(name)}</a> (${size} bytes)</li>`).join('\n');
      }

      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Personal Cloud Drive - WebDAV</title></head>
        <body style="font-family: system-ui, sans-serif; padding: 2rem;">
          <h2>📁 ${escapeXml(bucketName || 'Personal Cloud Drive')}</h2>
          <p>Connected as: <strong>${escapeXml(req.user.email)}</strong></p>
          <ul>${listHtml}</ul>
        </body>
        </html>
      `);
    }

    // Specific file requested
    const bucket = db.prepare('SELECT * FROM buckets WHERE user_id = ? AND (bucketName = ? OR id = ?)').get(req.user.id, bucketName, bucketName);
    if (!bucket) return res.status(404).send('Drive not found');

    // If file is still pending/processing in upload queue, stream directly from staged local disk
    const pending = db.prepare(
      "SELECT * FROM upload_queues WHERE bucket_id = ? AND file_name = ? AND status IN ('pending', 'processing', 'uploading_to_cloud') ORDER BY id DESC LIMIT 1"
    ).get(bucket.id, fileName);

    if (pending && fs.existsSync(pending.file_path)) {
      const stats = fs.statSync(pending.file_path);
      const fileSize = stats.size;
      const contentType = mime.lookup(fileName) || 'application/octet-stream';
      const lastModified = stats.mtime.toUTCString();

      if (req.method === 'HEAD') {
        res.set({
          'Content-Type': contentType,
          'Content-Length': fileSize,
          'Accept-Ranges': 'bytes',
          'Last-Modified': lastModified,
        });
        return res.status(200).end();
      }

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize || start > end) {
          res.set('Content-Range', `bytes */${fileSize}`);
          return res.status(416).end();
        }

        const chunksize = end - start + 1;
        res.status(206);
        res.set({
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
          'Last-Modified': lastModified,
        });
        return fs.createReadStream(pending.file_path, { start, end }).pipe(res);
      }

      res.set({
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Last-Modified': lastModified,
      });
      return fs.createReadStream(pending.file_path).pipe(res);
    }

    const channelData = await telegramService.getChannelFiles(bucket.channel_id, bucket.access_hash, bucket.id, 1, 1000);
    const file = channelData.files.find((f) => f.file_name === fileName);
    if (!file) return res.status(404).send('File not found');

    const msgId = safeDecryptId(file.msg_id, bucket.id) || (isFinite(file.msg_id) ? parseInt(file.msg_id, 10) : null);
    if (!msgId) return res.status(404).send('Invalid file ID');

    if (req.method === 'HEAD') {
      res.set({
        'Content-Type': file.mime_type || mime.lookup(fileName) || 'application/octet-stream',
        'Content-Length': file.size || 0,
        'Accept-Ranges': 'bytes',
        'Last-Modified': file.date ? new Date(file.date * 1000).toUTCString() : new Date().toUTCString(),
      });
      return res.status(200).end();
    }

    return await telegramService.streamMedia(bucket.channel_id, bucket.access_hash, msgId, req, res, false);
  } catch (error) {
    console.error('[WebDAV] GET/HEAD error:', error);
    if (!res.headersSent) return res.status(500).end();
  }
});

// 4. PUT Handler (Copy-paste / drag-and-drop file directly into drive)
router.all('*', async (req, res, next) => {
  if (req.method !== 'PUT') return next();

  try {
    const { bucketName, fileName } = parseWebdavPath(req);
    if (!bucketName || !fileName) {
      return res.status(400).send('Must specify drive and file name for upload');
    }

    const bucket = db.prepare('SELECT * FROM buckets WHERE user_id = ? AND (bucketName = ? OR id = ?)').get(req.user.id, bucketName, bucketName);
    if (!bucket) {
      return res.status(404).send('Destination drive not found');
    }

    // Pipe incoming binary stream directly to assembled storage directory
    const uploadId = crypto.randomUUID();
    const safeBaseName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const targetDir = getAssembledDir();
    safeMkdirSync(targetDir);
    const finalPath = path.join(targetDir, `dav_${uploadId}_${safeBaseName}`);

    const writeStream = fs.createWriteStream(finalPath);
    req.pipe(writeStream);

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      req.on('error', reject);
    });

    const stats = fs.statSync(finalPath);

    // Cancel any previous queued job for same file in this bucket
    const existingQueue = db.prepare(
      "SELECT * FROM upload_queues WHERE bucket_id = ? AND file_name = ? AND status IN ('pending', 'processing', 'uploading_to_cloud')"
    ).all(bucket.id, fileName);
    for (const eq of existingQueue) {
      db.prepare("UPDATE upload_queues SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(eq.id);
      try { if (fs.existsSync(eq.file_path)) fs.unlinkSync(eq.file_path); } catch (_) {}
    }

    // Insert into upload_queues for fast background cloud synchronization
    db.prepare(
      `INSERT INTO upload_queues (upload_id, bucket_id, channel_id, file_path, file_name, file_size, status, progress, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(uploadId, bucket.id, bucket.channel_id, finalPath, fileName, stats.size, req.user.id);

    processNextJob();

    const prefix = req.baseUrl || '/webdav';
    res.set({
      Location: `${prefix}/${encodeURIComponent(bucket.bucketName)}/${encodeURIComponent(fileName)}`,
      DAV: '1, 2',
    });
    return res.status(201).end();
  } catch (error) {
    console.error('[WebDAV] PUT error:', error);
    return res.status(500).send('Upload to drive failed: ' + error.message);
  }
});

// 5. DELETE Handler (Delete file or drive from OS file explorer)
router.all('*', async (req, res, next) => {
  if (req.method !== 'DELETE') return next();

  try {
    const { bucketName, fileName } = parseWebdavPath(req);
    if (!bucketName) return res.status(400).send('Invalid target');

    const bucket = db.prepare('SELECT * FROM buckets WHERE user_id = ? AND (bucketName = ? OR id = ?)').get(req.user.id, bucketName, bucketName);
    if (!bucket) return res.status(404).send('Drive not found');

    // Case A: Delete file
    if (fileName) {
      const pending = db.prepare(
        "SELECT * FROM upload_queues WHERE bucket_id = ? AND file_name = ? AND status IN ('pending', 'processing', 'uploading_to_cloud')"
      ).all(bucket.id, fileName);

      for (const job of pending) {
        db.prepare("UPDATE upload_queues SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);
        try {
          if (fs.existsSync(job.file_path)) fs.unlinkSync(job.file_path);
        } catch (_) {}
      }

      const channelData = await telegramService.getChannelFiles(bucket.channel_id, bucket.access_hash, bucket.id, 1, 1000);
      const file = channelData.files.find((f) => f.file_name === fileName);
      if (file) {
        const msgId = safeDecryptId(file.msg_id, bucket.id) || parseInt(file.msg_id, 10);
        if (msgId) {
          await telegramService.deleteMessages(bucket.channel_id, bucket.access_hash, [msgId]);
        }
      }
      return res.status(204).end();
    }

    // Case B: Delete drive / bucket
    try {
      if (bucket.channel_id && bucket.access_hash) {
        await telegramService.deleteChannel(bucket.channel_id, bucket.access_hash);
      }
    } catch (_) {}

    db.prepare('DELETE FROM bucket_shares WHERE bucket_id = ?').run(bucket.id);
    db.prepare('DELETE FROM buckets WHERE id = ?').run(bucket.id);
    db.prepare('UPDATE users SET bucketAllowed = bucketAllowed + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.id);

    return res.status(204).end();
  } catch (error) {
    console.error('[WebDAV] DELETE error:', error);
    return res.status(500).send('Delete failed');
  }
});

// 6. MKCOL Handler (Create new drive / folder from OS file explorer)
router.all('*', async (req, res, next) => {
  if (req.method !== 'MKCOL') return next();

  try {
    const { bucketName, fileName } = parseWebdavPath(req);
    if (!bucketName || fileName) {
      return res.status(403).send('Only top-level drives can be created via MKCOL');
    }

    if (req.user.bucketAllowed < 1) {
      return res.status(507).send('Drive quota exceeded');
    }

    let channelId = null;
    let accessHash = null;

    try {
      const channel = await telegramService.createPrivateChannel(bucketName);
      channelId = channel.channel_id;
      accessHash = channel.access_hash;
    } catch (err) {
      channelId = `-100${Date.now()}`;
      accessHash = '0';
    }

    db.prepare(
      `INSERT INTO buckets (user_id, bucketName, channel_id, access_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(req.user.id, bucketName, channelId, accessHash);

    db.prepare('UPDATE users SET bucketAllowed = bucketAllowed - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.id);

    return res.status(201).end();
  } catch (error) {
    console.error('[WebDAV] MKCOL error:', error);
    return res.status(500).send('Drive creation failed');
  }
});

// 7. LOCK & UNLOCK Handlers (Required by Microsoft Office & Windows Explorer)
router.all('*', (req, res, next) => {
  if (req.method === 'LOCK') {
    const lockToken = crypto.randomUUID();
    res.set({
      'Content-Type': 'application/xml; charset="utf-8"',
      'Lock-Token': `<urn:uuid:${lockToken}>`,
      DAV: '1, 2',
    });

    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>0</D:depth>
      <D:owner><D:href>${escapeXml(req.user.email)}</D:href></D:owner>
      <D:timeout>Second-3600</D:timeout>
      <D:locktoken><D:href>urn:uuid:${lockToken}</D:href></D:locktoken>
      <D:lockroot><D:href>${escapeXml(req.originalUrl)}</D:href></D:lockroot>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`;

    return res.status(200).send(xml);
  }

  if (req.method === 'UNLOCK') {
    return res.status(204).end();
  }

  if (req.method === 'PROPPATCH') {
    res.set('Content-Type', 'application/xml; charset="utf-8"');
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${escapeXml(req.originalUrl)}</D:href>
    <D:propstat>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    return res.status(207).send(xml);
  }

  next();
});

module.exports = router;
