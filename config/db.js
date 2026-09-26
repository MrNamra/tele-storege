const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbPath = process.env.DB_FILE || path.join(__dirname, '../database/database.sqlite');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Performance optimizations for 1 CPU / 1GB RAM
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -32000'); // 32MB cache
db.pragma('foreign_keys = ON');

// Initialize schema if starting fresh
db.exec(`
  CREATE TABLE IF NOT EXISTS "users" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    "name" VARCHAR NOT NULL,
    "email" VARCHAR NOT NULL UNIQUE,
    "role" VARCHAR CHECK ("role" IN ('user', 'admin')) NOT NULL DEFAULT 'user',
    "bucketAllowed" INTEGER NOT NULL DEFAULT 5,
    "email_verified_at" DATETIME,
    "password" VARCHAR NOT NULL,
    "remember_token" VARCHAR,
    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR CHECK ("status" IN ('active', 'suspended')) NOT NULL DEFAULT 'active',
    "status_reason" VARCHAR,
    "last_login_at" DATETIME
  );

  CREATE TABLE IF NOT EXISTS "buckets" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "bucketName" VARCHAR NOT NULL,
    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "channel_id" VARCHAR,
    "access_hash" VARCHAR,
    FOREIGN KEY("user_id") REFERENCES "users"("id") ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS "bucket_shares" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    "bucket_id" INTEGER NOT NULL,
    "password" VARCHAR,
    "code" VARCHAR NOT NULL UNIQUE,
    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("bucket_id") REFERENCES "buckets"("id") ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS "personal_access_tokens" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    "tokenable_type" VARCHAR NOT NULL,
    "tokenable_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "token" VARCHAR NOT NULL,
    "abilities" TEXT,
    "last_used_at" DATETIME,
    "expires_at" DATETIME,
    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS "upload_queues" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    "upload_id" VARCHAR NOT NULL UNIQUE,
    "bucket_id" INTEGER,
    "channel_id" VARCHAR NOT NULL,
    "file_path" VARCHAR NOT NULL,
    "file_name" VARCHAR NOT NULL,
    "file_size" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = db;