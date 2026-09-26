const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { safeEncryptId, safeDecryptId, isCompactSignedIdForBucket } = require('../utils/crypto');

const sessionFile = path.join(__dirname, '../storage/telegram/session.txt');
const apiId = parseInt(process.env.TELEGRAM_API_ID === '824488511' ? '27622442' : (process.env.TELEGRAM_API_ID || '27622442'), 10);
const apiHash = process.env.TELEGRAM_API_HASH || 'd21311e9010f410a84606f286a45939a';

let clientInstance = null;
let clientConnectingPromise = null;
const strippedCache = new Map(); // In-memory cache for stripped thumbnail buffers (<1KB each)

function getSessionString() {
  if (process.env.TELEGRAM_STRING_SESSION) {
    return process.env.TELEGRAM_STRING_SESSION.trim();
  }
  if (fs.existsSync(sessionFile)) {
    return fs.readFileSync(sessionFile, 'utf8').trim();
  }
  return '';
}

function saveSessionString(sessionStr) {
  const dir = path.dirname(sessionFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionFile, sessionStr, 'utf8');
}

async function getClient() {
  if (clientInstance && clientInstance.connected) {
    return clientInstance;
  }
  if (clientConnectingPromise) {
    return clientConnectingPromise;
  }

  clientConnectingPromise = (async () => {
    const sessionStr = getSessionString();
    const stringSession = new StringSession(sessionStr);

    const client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
      useWSS: false,
    });

    try {
      await client.connect();
      if (!sessionStr && process.env.BOT_TOKEN) {
        await client.start({ botAuthToken: process.env.BOT_TOKEN });
        saveSessionString(client.session.save());
      }
    } catch (err) {
      console.warn('[Telegram] Connect notice:', err.message);
    }

    clientInstance = client;
    clientConnectingPromise = null;
    return client;
  })();

  return clientConnectingPromise;
}

async function isAuthorized() {
  try {
    const client = await getClient();
    return await client.isUserAuthorized();
  } catch {
    return false;
  }
}

function getInputPeer(channelId, accessHash) {
  const cleanId = channelId.toString().replace(/^-100/, '').replace(/^-/, '');
  if (accessHash) {
    return new Api.InputPeerChannel({
      channelId: BigInt(cleanId),
      accessHash: BigInt(accessHash),
    });
  }
  return BigInt(cleanId);
}

// Convert Telegram stripped thumbnail bytes into valid JPEG
function extractStrippedJpeg(rawBytes) {
  if (!rawBytes || rawBytes.length < 3) return null;
  if (rawBytes[0] !== 0x01) return Buffer.from(rawBytes);

  const header = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x28, 0x1c, 0x1e, 0x23, 0x1e, 0x19, 0x28,
    0x23, 0x21, 0x23, 0x2d, 0x2b, 0x28, 0x30, 0x3c, 0x64, 0x41, 0x3c, 0x37, 0x37, 0x3c, 0x7b, 0x58,
    0x5d, 0x49, 0x64, 0x91, 0x80, 0x99, 0x96, 0x8f, 0x80, 0x8c, 0x8a, 0xa0, 0xb4, 0xe6, 0xc3, 0xa0,
    0xaa, 0xda, 0xae, 0x8a, 0x8c, 0xc8, 0xff, 0xcb, 0xda, 0xee, 0xf5, 0xff, 0xff, 0xfb, 0x9b, 0xc1,
    0xff, 0xff, 0xff, 0xfa, 0xff, 0xe6, 0xfd, 0xff, 0xf8, 0xff, 0xc0, 0x00, 0x11, 0x08,
  ]);

  const height = rawBytes[1];
  const width = rawBytes[2];
  const sizeBuf = Buffer.from([0x00, height, 0x00, width, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  const middle = Buffer.from([
    0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a,
    0x0b, 0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
  ]);

  const payload = rawBytes.subarray(3);
  const footer = Buffer.from([0xff, 0xd9]);

  return Buffer.concat([header, sizeBuf, middle, payload, footer]);
}

async function createPrivateChannel(name) {
  const client = await getClient();
  const result = await client.invoke(
    new Api.channels.CreateChannel({
      title: name,
      about: 'Bucket Storage Private Channel',
      broadcast: true,
      megagroup: false,
    })
  );

  const chat = result.chats[0];
  return {
    channel_id: `-${chat.id}`,
    access_hash: chat.accessHash ? chat.accessHash.toString() : null,
  };
}

async function updateChannelName(channelId, accessHash, newName) {
  const client = await getClient();
  await client.invoke(
    new Api.channels.EditTitle({
      channel: getInputPeer(channelId, accessHash),
      title: newName,
    })
  );
  return true;
}

async function deleteChannel(channelId, accessHash) {
  const client = await getClient();
  try {
    await client.invoke(
      new Api.channels.DeleteChannel({
        channel: getInputPeer(channelId, accessHash),
      })
    );
    return true;
  } catch (err) {
    try {
      await client.invoke(
        new Api.channels.LeaveChannel({
          channel: getInputPeer(channelId, accessHash),
        })
      );
      return true;
    } catch {
      throw err;
    }
  }
}

async function getChannelFiles(channelId, accessHash, bucketId, page = 1, perPage = 15) {
  const client = await getClient();
  const peer = getInputPeer(channelId, accessHash);

  page = Math.max(1, parseInt(page, 10) || 1);
  perPage = Math.max(1, Math.min(100, parseInt(perPage, 10) || 15));

  const emptyResponse = {
    files: [],
    pagination: {
      currentPage: page,
      perPage,
      totalFiles: 0,
      totalPages: 1,
    },
    totalStorage: 0,
  };

  let messages = [];
  try {
    const isAuth = await isAuthorized();
    if (!isAuth) {
      console.warn('[Telegram] Client not authorized yet. Run "npm run telegram:login" to authenticate.');
      return emptyResponse;
    }

    messages = await client.getMessages(peer, {
      limit: perPage,
      addOffset: (page - 1) * perPage,
    });
  } catch (err) {
    console.warn(`[Telegram] getChannelFiles notice for ${channelId}:`, err.message);
    return emptyResponse;
  }

  const files = [];
  let totalStorageBytes = 0;

  for (const msg of messages) {
    if (!msg.media) continue;

    const encId = safeEncryptId(msg.id, bucketId);
    let type = 'document';
    let mimeType = 'application/octet-stream';
    let fileName = `file_${msg.id}`;
    let size = 0;

    if (msg.photo) {
      type = 'photo';
      mimeType = 'image/jpeg';
      fileName = `photo_${msg.id}.jpg`;
      const sizes = msg.photo.sizes || [];
      if (sizes.length > 0) {
        const largest = sizes[sizes.length - 1];
        size = largest.size || (largest.sizes ? largest.sizes[largest.sizes.length - 1] : 0);
      }
      // Check stripped thumb
      for (const s of sizes) {
        if (s.className === 'PhotoStrippedSize' && s.bytes) {
          const stripped = extractStrippedJpeg(s.bytes);
          if (stripped) strippedCache.set(`${channelId}_${msg.id}`, stripped);
        }
      }
    } else if (msg.document) {
      const doc = msg.document;
      mimeType = doc.mimeType || 'application/octet-stream';
      size = Number(doc.size || 0);

      if (doc.attributes) {
        for (const attr of doc.attributes) {
          if (attr.fileName) fileName = attr.fileName;
          if (attr.className === 'DocumentAttributeVideo') type = 'video';
          if (attr.className === 'DocumentAttributeAudio' && type !== 'video') type = 'audio';
        }
      }

      if (type === 'document') {
        if (mimeType.startsWith('video/')) type = 'video';
        else if (mimeType.startsWith('audio/')) type = 'audio';
        else if (mimeType.startsWith('image/')) type = 'photo';
      }

      if (doc.thumbs) {
        for (const t of doc.thumbs) {
          if (t.className === 'PhotoStrippedSize' && t.bytes) {
            const stripped = extractStrippedJpeg(t.bytes);
            if (stripped) strippedCache.set(`${channelId}_${msg.id}`, stripped);
          }
        }
      }
    } else {
      continue;
    }

    totalStorageBytes += size;

    files.push({
      msg_id: encId,
      date: msg.date,
      type,
      file_name: fileName,
      mime_type: mimeType,
      size,
      thumbnail: `/t/${bucketId}/${encId}`,
      stream_url: `/s/${bucketId}/${encId}`,
    });
  }

  const totalFiles = (page - 1) * perPage + files.length;
  const totalStorageMB = Math.round((totalStorageBytes / (1024 * 1024)) * 100) / 100;

  return {
    files,
    pagination: {
      currentPage: page,
      perPage,
      totalFiles: files.length === perPage ? totalFiles + 1 : totalFiles,
      totalPages: files.length === perPage ? page + 1 : Math.max(1, page),
    },
    totalStorage: totalStorageMB,
  };
}

async function getMessageById(channelId, accessHash, msgId) {
  const client = await getClient();
  const peer = getInputPeer(channelId, accessHash);
  const messages = await client.getMessages(peer, { ids: [Number(msgId)] });
  return messages && messages.length > 0 ? messages[0] : null;
}

function serveFallbackBadge(res, mimeType) {
  let color = '#6366f1';
  let label = 'FILE';
  if (mimeType) {
    if (mimeType.startsWith('video/')) { color = '#ef4444'; label = 'VIDEO'; }
    else if (mimeType.startsWith('audio/')) { color = '#8b5cf6'; label = 'AUDIO'; }
    else if (mimeType.includes('pdf')) { color = '#dc2626'; label = 'PDF'; }
    else if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('compressed')) { color = '#f59e0b'; label = 'ZIP'; }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">
    <rect width="160" height="160" rx="16" fill="#f8fafc"/>
    <rect x="25" y="20" width="110" height="120" rx="12" fill="white" stroke="#e2e8f0" stroke-width="2"/>
    <rect x="40" y="36" width="80" height="38" rx="8" fill="${color}" opacity="0.12"/>
    <text x="80" y="60" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="${color}" text-anchor="middle" letter-spacing="1">${label}</text>
    <circle cx="80" y="104" r="16" fill="${color}"/>
    <path d="M75 96 L89 104 L75 112 Z" fill="white"/>
  </svg>`;

  res.writeHead(200, {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'public, max-age=604800, immutable',
    'Access-Control-Allow-Origin': '*',
  });
  return res.end(svg);
}

// Ultra-fast memory thumbnail streaming
async function streamThumbnail(channelId, accessHash, msgId, req, res) {
  const cacheKey = `${channelId}_${msgId}`;
  if (strippedCache.has(cacheKey)) {
    const buf = strippedCache.get(cacheKey);
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=604800, immutable',
      'Access-Control-Allow-Origin': '*',
    });
    return res.end(buf);
  }

  const msg = await getMessageById(channelId, accessHash, msgId);
  if (!msg || !msg.media) {
    return serveFallbackBadge(res, null);
  }

  // Check stripped thumbnail in message
  const thumbs = (msg.photo && msg.photo.sizes) || (msg.document && msg.document.thumbs) || [];
  for (const t of thumbs) {
    if (t.className === 'PhotoStrippedSize' && t.bytes) {
      const stripped = extractStrippedJpeg(t.bytes);
      if (stripped) {
        strippedCache.set(cacheKey, stripped);
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': stripped.length,
          'Cache-Control': 'public, max-age=604800, immutable',
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(stripped);
      }
    }
  }

  // Fallback badge if no thumbnail available
  const mimeType = (msg.document && msg.document.mimeType) || (msg.photo ? 'image/jpeg' : null);
  return serveFallbackBadge(res, mimeType);
}

// Smooth streaming with HTTP 206 Byte Range support directly from Telegram
async function streamMedia(channelId, accessHash, msgId, req, res, forceDownload = false) {
  const msg = await getMessageById(channelId, accessHash, msgId);
  if (!msg || !msg.media) {
    return res.status(404).json({ status: false, message: 'File not found' });
  }

  let mimeType = 'application/octet-stream';
  let fileName = `file_${msgId}`;
  let fileSize = 0;

  if (msg.photo) {
    mimeType = 'image/jpeg';
    fileName = `photo_${msgId}.jpg`;
    const sizes = msg.photo.sizes || [];
    if (sizes.length > 0) {
      const largest = sizes[sizes.length - 1];
      fileSize = largest.size || (largest.sizes ? largest.sizes[largest.sizes.length - 1] : 0);
    }
  } else if (msg.document) {
    const doc = msg.document;
    mimeType = doc.mimeType || 'application/octet-stream';
    fileSize = Number(doc.size || 0);
    if (doc.attributes) {
      for (const attr of doc.attributes) {
        if (attr.fileName) fileName = attr.fileName;
      }
    }
  }

  const disposition = forceDownload ? 'attachment' : 'inline';

  // Support HEAD request for probing metadata (safari, chrome, video players)
  if (req.method === 'HEAD') {
    return res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `${disposition}; filename="${encodeURIComponent(fileName)}"`,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    }).end();
  }

  const client = await getClient();
  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    let start = parts[0] ? parseInt(parts[0], 10) : 0;
    let end = parts[1] ? parseInt(parts[1], 10) : 0;

    if (parts[0] === '' && parts[1] !== '') {
      // Suffix range (last N bytes, e.g. for MP4 moov metadata)
      const suffix = parseInt(parts[1], 10);
      start = fileSize > 0 ? Math.max(0, fileSize - suffix) : 0;
      end = fileSize > 0 ? fileSize - 1 : 0;
    } else if (parts[0] !== '' && parts[1] === '') {
      // Open-ended range (stream in smooth 2MB window)
      const windowSize = 2 * 1024 * 1024;
      end = fileSize > 0 ? Math.min(fileSize - 1, start + windowSize - 1) : start + windowSize - 1;
    } else {
      end = fileSize > 0 ? Math.min(fileSize - 1, end) : end;
    }

    if (fileSize > 0 && start >= fileSize) {
      res.writeHead(416, {
        'Content-Range': `bytes */${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end();
    }

    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize || '*'}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
      'Content-Disposition': `${disposition}; filename="${encodeURIComponent(fileName)}"`,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    });

    let isAborted = false;
    res.on('close', () => { isAborted = true; });

    try {
      for await (const chunk of client.iterDownload({
        file: msg.media,
        offset: BigInt(start),
        limit: chunkSize,
        chunkSize: 256 * 1024,
      })) {
        if (isAborted) break;
        if (!res.write(chunk)) {
          await new Promise((resolve) => res.once('drain', resolve));
        }
      }
    } catch (err) {
      if (!isAborted) console.error('Streaming chunk error:', err.message);
    } finally {
      if (!isAborted) res.end();
    }
  } else {
    // Full content download / stream
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Content-Disposition': `${disposition}; filename="${encodeURIComponent(fileName)}"`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    });

    let isAborted = false;
    res.on('close', () => { isAborted = true; });

    try {
      for await (const chunk of client.iterDownload({
        file: msg.media,
        chunkSize: 512 * 1024,
      })) {
        if (isAborted) break;
        if (!res.write(chunk)) {
          await new Promise((resolve) => res.once('drain', resolve));
        }
      }
    } catch (err) {
      if (!isAborted) console.error('Download stream error:', err.message);
    } finally {
      if (!isAborted) res.end();
    }
  }
}

async function uploadFileToChannel(channelId, accessHash, filePath, originalName, progressCallback) {
  const client = await getClient();
  const peer = getInputPeer(channelId, accessHash);

  const mimeType = mime.lookup(originalName) || 'application/octet-stream';
  const isVideo = mimeType.startsWith('video/');
  const isAudio = mimeType.startsWith('audio/');

  const attributes = [
    new Api.DocumentAttributeFilename({ fileName: originalName }),
  ];

  if (isVideo) {
    attributes.push(new Api.DocumentAttributeVideo({ supportsStreaming: true }));
  } else if (isAudio) {
    attributes.push(new Api.DocumentAttributeAudio({ voice: false }));
  }

  const result = await client.sendFile(peer, {
    file: filePath,
    forceDocument: !mimeType.startsWith('image/'),
    attributes,
    progressCallback: (progress) => {
      if (typeof progressCallback === 'function') {
        progressCallback(progress);
      }
    },
  });

  return result;
}

async function deleteMessages(channelId, accessHash, msgIds) {
  const client = await getClient();
  const peer = getInputPeer(channelId, accessHash);
  const ids = msgIds.map((id) => Number(id));
  await client.deleteMessages(peer, ids, { revoke: true });
  return true;
}

module.exports = {
  getClient,
  isAuthorized,
  saveSessionString,
  createPrivateChannel,
  updateChannelName,
  deleteChannel,
  getChannelFiles,
  getMessageById,
  streamThumbnail,
  streamMedia,
  uploadFileToChannel,
  deleteMessages,
};
