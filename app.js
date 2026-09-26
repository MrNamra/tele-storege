const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const db = require('./config/db');
const { startQueueWorker } = require('./services/queueService');
const { startCleanupWorker } = require('./services/cleanupService');
const telegramService = require('./services/telegramService');

const authRoutes = require('./routes/auth');
const bucketRoutes = require('./routes/bucket');
const fileRoutes = require('./routes/file');
const uploadRoutes = require('./routes/upload');
const adminRoutes = require('./routes/admin');

const app = express();

// Performance and security settings
app.set('trust proxy', 1);
app.disable('x-powered-by');

// CORS configuration (crucial for streaming Range requests & cross-origin previews)
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Range',
      'Authorization',
      'Content-Type',
      'Origin',
      'Accept',
      'X-Requested-With',
      'x-bucket-password',
    ],
    exposedHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges'],
    maxAge: 86400,
  })
);

app.options('*', cors());

// Body parser middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// 1. Root level media & streaming routes (matching Laravel root routes: /s/..., /t/..., /d/...)
app.use('/', fileRoutes);

// 2. API Routes
app.use('/api', authRoutes);
app.use('/api/bucket', bucketRoutes);
app.use('/api', fileRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/admin', adminRoutes);

// 3. Static frontend assets serving
const publicDir = path.join(__dirname, 'public');
const frontendDir = path.join(__dirname, 'frontend');
const distDir = path.join(__dirname, 'storage-frontend/dist');

let staticDir = publicDir;
if (fs.existsSync(path.join(publicDir, 'index.html'))) {
  staticDir = publicDir;
} else if (fs.existsSync(path.join(frontendDir, 'index.html'))) {
  staticDir = frontendDir;
} else if (fs.existsSync(path.join(distDir, 'index.html'))) {
  staticDir = distDir;
}

app.use(
  express.static(staticDir, {
    maxAge: '1d',
    setHeaders: (res, filePath) => {
      // Long-term immutable caching for hashed Vite build assets
      if (filePath.includes('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);

// 4. Global Error Handling Middleware (Catches MulterErrors, JSON parse errors, etc.)
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  // Handle Multer errors (e.g. file size exceeded, unexpected field name)
  if (err && (err.name === 'MulterError' || err.code === 'LIMIT_UNEXPECTED_FILE')) {
    console.warn(`[MulterError] ${err.message} on ${req.method} ${req.originalUrl}${err.field ? ` (field: "${err.field}")` : ''}`);
    return res.status(400).json({
      status: false,
      success: false,
      error: err.code || 'MULTER_ERROR',
      message: `File upload error: ${err.message}${err.field ? ` (field: "${err.field}")` : ''}. Any field name is accepted.`,
    });
  }

  console.error(`[Server Error] on ${req.method} ${req.originalUrl}:`, err);
  return res.status(err.status || 500).json({
    status: false,
    success: false,
    message: err.message || 'Internal server error',
  });
});

// 5. SPA Fallback for client-side routing
app.get('*', (req, res) => {
  // If it's an API route that reached here, return JSON 404
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ status: false, message: 'API route not found' });
  }

  const indexPath = path.join(staticDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.status(404).send('Frontend not built. Please run: npm run build:frontend');
});

if (require.main === module) {
  // Start sequential background upload worker (keeps RAM < 80MB on 1GB VPS)
  startQueueWorker();
  // Start automated storage cleanup worker (purges temp files and old chunks every 5 mins)
  startCleanupWorker();

  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(`🚀 CloudVault Node.js Server running on port ${PORT}`);
    console.log(`📊 Memory optimized for 1 CPU / 1GB RAM`);
    console.log(`⚡ Smooth Range streaming enabled on /s/:bucket/:id`);
    console.log(`===================================================`);
  });

  // Graceful shutdown handling
  const shutdown = async (signal) => {
    console.log(`${signal} signal received: closing server cleanly`);
    try {
      await telegramService.disconnectClient();
    } catch {}
    server.close(() => {
      try { db.close(); } catch {}
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
