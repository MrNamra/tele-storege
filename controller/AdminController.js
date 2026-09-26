const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { generateToken, hashToken } = require('../utils/crypto');
const { sanitizeUser } = require('./AuthController');

function createSanctumToken(userId, name = 'impersonation_token') {
  const plain = generateToken();
  const hashed = hashToken(plain);

  const result = db
    .prepare(
      `INSERT INTO personal_access_tokens (tokenable_type, tokenable_id, name, token, created_at, updated_at)
       VALUES ('App\\\\Models\\\\User', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .run(userId, name, hashed);

  return `${result.lastInsertRowid}|${plain}`;
}

const stats = async (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const activeUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get().count;
    const suspendedUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'suspended'").get().count;
    const totalBuckets = db.prepare('SELECT COUNT(*) as count FROM buckets').get().count;
    const totalShares = db.prepare('SELECT COUNT(*) as count FROM bucket_shares').get().count;

    return res.status(200).json({
      status: true,
      data: {
        totalUsers,
        activeUsers,
        suspendedUsers,
        totalBuckets,
        totalShares,
      },
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const users = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.max(1, Math.min(100, parseInt(req.query.per_page, 10) || 15));
    const search = req.query.search ? `%${req.query.search.trim()}%` : null;
    const statusFilter = req.query.status || null;
    const roleFilter = req.query.role || null;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (search) {
      whereClause += ' AND (name LIKE ? OR email LIKE ?)';
      params.push(search, search);
    }
    if (statusFilter) {
      whereClause += ' AND status = ?';
      params.push(statusFilter);
    }
    if (roleFilter) {
      whereClause += ' AND role = ?';
      params.push(roleFilter);
    }

    const totalCount = db.prepare(`SELECT COUNT(*) as count FROM users ${whereClause}`).get(...params).count;

    const offset = (page - 1) * perPage;
    const rows = db
      .prepare(`SELECT * FROM users ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, perPage, offset);

    const safeRows = rows.map((u) => {
      const bucketCount = db.prepare('SELECT COUNT(*) as count FROM buckets WHERE user_id = ?').get(u.id).count;
      return {
        ...sanitizeUser(u),
        buckets_count: bucketCount,
      };
    });

    return res.status(200).json({
      status: true,
      data: {
        data: safeRows,
        current_page: page,
        per_page: perPage,
        total: totalCount,
        last_page: Math.ceil(totalCount / perPage) || 1,
      },
    });
  } catch (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const show = async (req, res) => {
  try {
    const userId = req.params.user;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    const buckets = db.prepare('SELECT * FROM buckets WHERE user_id = ? ORDER BY id DESC').all(user.id);

    return res.status(200).json({
      status: true,
      data: {
        ...sanitizeUser(user),
        buckets,
      },
    });
  } catch (error) {
    console.error('Admin show user error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const update = async (req, res) => {
  try {
    const userId = req.params.user;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    const { name, email, role, bucketAllowed, status, status_reason } = req.body;

    if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), userId);
    if (email && email.toLowerCase().trim() !== user.email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.toLowerCase().trim(), userId);
      if (existing) {
        return res.status(422).json({ status: false, message: 'Email already taken' });
      }
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email.toLowerCase().trim(), userId);
    }
    if (role && ['user', 'admin'].includes(role)) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    }
    if (bucketAllowed !== undefined) {
      db.prepare('UPDATE users SET bucketAllowed = ? WHERE id = ?').run(parseInt(bucketAllowed, 10), userId);
    }
    if (status && ['active', 'suspended'].includes(status)) {
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId);
    }
    if (status_reason !== undefined) {
      db.prepare('UPDATE users SET status_reason = ? WHERE id = ?').run(status_reason, userId);
    }

    db.prepare('UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    return res.status(200).json({
      status: true,
      message: 'User updated successfully',
      data: sanitizeUser(updated),
    });
  } catch (error) {
    console.error('Admin update user error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const destroy = async (req, res) => {
  try {
    const userId = req.params.user;

    if (Number(userId) === Number(req.user.id)) {
      return res.status(400).json({ status: false, message: 'Cannot delete your own admin account.' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    return res.status(200).json({
      status: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    console.error('Admin delete user error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const impersonate = async (req, res) => {
  try {
    const userId = req.params.user;
    const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (!targetUser) {
      return res.status(404).json({ status: false, message: 'Target user not found' });
    }

    const token = createSanctumToken(targetUser.id, `impersonation_by_${req.user.id}`);

    return res.status(200).json({
      status: true,
      message: `Impersonating ${targetUser.name}`,
      data: {
        user: sanitizeUser(targetUser),
        token,
      },
      token,
      user: sanitizeUser(targetUser),
    });
  } catch (error) {
    console.error('Admin impersonate error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const changePassword = async (req, res) => {
  try {
    const userId = req.params.user;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(422).json({ status: false, message: 'Password must be at least 6 characters' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hashedPassword, userId);

    return res.status(200).json({
      status: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    console.error('Admin change password error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const toggleStatus = async (req, res) => {
  try {
    const userId = req.params.user;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    if (Number(userId) === Number(req.user.id)) {
      return res.status(400).json({ status: false, message: 'Cannot suspend your own account.' });
    }

    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    const reason = req.body.status_reason || (newStatus === 'suspended' ? 'Suspended by admin' : null);

    db.prepare('UPDATE users SET status = ?, status_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      newStatus,
      reason,
      userId
    );

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    return res.status(200).json({
      status: true,
      message: `User status updated to ${newStatus}`,
      data: sanitizeUser(updated),
    });
  } catch (error) {
    console.error('Admin toggle status error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

module.exports = {
  stats,
  users,
  show,
  update,
  destroy,
  impersonate,
  changePassword,
  toggleStatus,
};
