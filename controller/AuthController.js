const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { hashToken, generateToken } = require('../utils/crypto');

function createSanctumToken(userId, name = 'auth_token') {
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

function sanitizeUser(user) {
  if (!user) return null;
  const { password, remember_token, ...safe } = user;
  return safe;
}

const register = async (req, res) => {
  try {
    const { name, email, password, password_confirmation } = req.body;

    if (!name || !email || !password) {
      return res.status(422).json({
        status: false,
        message: 'Name, email and password are required.',
      });
    }

    if (password_confirmation && password !== password_confirmation) {
      return res.status(422).json({
        status: false,
        message: 'The password confirmation does not match.',
      });
    }

    if (password.length < 6) {
      return res.status(422).json({
        status: false,
        message: 'Password must be at least 6 characters.',
      });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) {
      return res.status(422).json({
        status: false,
        message: 'The email has already been taken.',
      });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = db
      .prepare(
        `INSERT INTO users (name, email, password, role, bucketAllowed, status, created_at, updated_at)
         VALUES (?, ?, ?, 'user', 5, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run(name.trim(), email.toLowerCase().trim(), hashedPassword);

    const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    const token = createSanctumToken(newUser.id);

    return res.status(200).json({
      status: true,
      message: 'User registered successfully',
      data: {
        user: sanitizeUser(newUser),
        token,
      },
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(422).json({
        status: false,
        message: 'Email and password are required.',
      });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) {
      return res.status(401).json({
        status: false,
        message: 'Invalid credentials.',
      });
    }

    const matches = bcrypt.compareSync(password, user.password);
    if (!matches) {
      return res.status(401).json({
        status: false,
        message: 'Invalid credentials.',
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        status: false,
        message: `Account is suspended: ${user.status_reason || 'Please contact an administrator.'}`,
      });
    }

    // Update last_login_at
    db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    const token = createSanctumToken(user.id);

    return res.status(200).json({
      status: true,
      message: 'Login successful',
      data: {
        user: sanitizeUser(user),
        token,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const profile = async (req, res) => {
  return res.status(200).json({
    status: true,
    data: sanitizeUser(req.user),
  });
};

const updateProfile = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const userId = req.user.id;

    if (name) {
      db.prepare('UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name.trim(), userId);
    }

    if (email && email.toLowerCase().trim() !== req.user.email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.toLowerCase().trim(), userId);
      if (existing) {
        return res.status(422).json({ status: false, message: 'Email is already in use.' });
      }
      db.prepare('UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(email.toLowerCase().trim(), userId);
    }

    if (password && password.length >= 6) {
      const hashedPassword = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hashedPassword, userId);
    }

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    return res.status(200).json({
      status: true,
      message: 'Profile updated successfully',
      data: sanitizeUser(updated),
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

const dashboard = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = db.prepare('SELECT id, name, email, bucketAllowed, status FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found.' });
    }

    const buckets = db.prepare('SELECT id, bucketName, created_at FROM buckets WHERE user_id = ? ORDER BY id DESC').all(userId);

    const bucketList = buckets.map((b) => {
      const share = db.prepare('SELECT code FROM bucket_shares WHERE bucket_id = ?').get(b.id);
      return {
        id: b.id,
        bucketName: b.bucketName,
        code: share ? share.code : null,
        created_at: b.created_at,
      };
    });

    return res.status(200).json({
      status: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          bucketAllowed: user.bucketAllowed,
          status: user.status || 'active',
        },
        bucket: bucketList,
      },
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return res.status(500).json({ status: false, message: 'Server error: ' + error.message });
  }
};

module.exports = {
  register,
  login,
  profile,
  updateProfile,
  dashboard,
  sanitizeUser,
};