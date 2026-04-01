const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');
const { generateAccessToken, generateRefreshToken, verifyToken } = require('../utils/jwt');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');

const register = async (req, res) => {
  const client = await pool.connect();
  try {
    const { firstName, email, password, is18Confirmed } = req.body;

    if (!is18Confirmed) {
      return res.status(400).json({ success: false, message: 'You must confirm you are 18 or older to use AreWe?' });
    }

    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await client.query('BEGIN');

    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, is_18_confirmed, first_name) VALUES ($1, $2, $3, $4) RETURNING id, email, first_name`,
      [email.toLowerCase(), passwordHash, true, firstName?.trim() || null]
    );
    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO user_profiles (user_id) VALUES ($1)`,
      [user.id]
    );

    const verificationToken = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, verificationToken, expiresAt]
    );

    await client.query('COMMIT');

    try {
      await sendVerificationEmail(user.email, verificationToken);
    } catch (emailErr) {
      console.error('Email send failed:', emailErr.message);
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, user.id]);

    return res.status(201).json({
      success: true,
      message: 'Account created. Please check your email to verify your account.',
      data: {
        user: { id: user.id, firstName: user.first_name, email: user.email, isVerified: false, is18Confirmed: true },
        accessToken,
        refreshToken,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Register error:', err);
    return res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  } finally {
    client.release();
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      `SELECT id, email, password_hash, is_verified, is_18_confirmed, is_active, is_blocked 
       , first_name
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (!result.rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({ success: false, message: 'This account has been deactivated' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ success: false, message: 'This account has been suspended' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    await pool.query('UPDATE users SET refresh_token = $1, updated_at = NOW() WHERE id = $2', [refreshToken, user.id]);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          firstName: user.first_name,
          email: user.email,
          isVerified: user.is_verified,
          is18Confirmed: user.is_18_confirmed,
        },
        accessToken,
        refreshToken,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
};

const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    const result = await pool.query(
      `SELECT * FROM email_verification_tokens WHERE token = $1 AND used = FALSE AND expires_at > NOW()`,
      [token]
    );

    if (!result.rows.length) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification link' });
    }

    const record = result.rows[0];

    await pool.query('UPDATE users SET is_verified = TRUE, updated_at = NOW() WHERE id = $1', [record.user_id]);
    await pool.query('UPDATE email_verification_tokens SET used = TRUE WHERE id = $1', [record.id]);

    return res.status(200).json({ success: true, message: 'Email verified successfully' });
  } catch (err) {
    console.error('Verify email error:', err);
    return res.status(500).json({ success: false, message: 'Verification failed. Please try again.' });
  }
};

const resendVerification = async (req, res) => {
  try {
    const { email } = req.body;

    const result = await pool.query('SELECT id, is_verified FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!result.rows.length) {
      return res.status(200).json({ success: true, message: 'If that email exists, a verification link has been sent.' });
    }

    const user = result.rows[0];
    if (user.is_verified) {
      return res.status(400).json({ success: false, message: 'This email is already verified' });
    }

    await pool.query('UPDATE email_verification_tokens SET used = TRUE WHERE user_id = $1', [user.id]);

    const verificationToken = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, verificationToken, expiresAt]
    );

    await sendVerificationEmail(email.toLowerCase(), verificationToken);

    return res.status(200).json({ success: true, message: 'Verification email sent.' });
  } catch (err) {
    console.error('Resend verification error:', err);
    return res.status(500).json({ success: false, message: 'Failed to resend. Please try again.' });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const result = await pool.query('SELECT id FROM users WHERE email = $1 AND is_active = TRUE', [email.toLowerCase()]);

    if (!result.rows.length) {
      return res.status(200).json({ success: true, message: 'If that email exists, a reset link has been sent.' });
    }

    const user = result.rows[0];

    await pool.query('UPDATE password_reset_tokens SET used = TRUE WHERE user_id = $1', [user.id]);

    const resetToken = uuidv4();
    const expiresMinutes = parseInt(process.env.PASSWORD_RESET_EXPIRES_MINUTES || 30);
    const expiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, resetToken, expiresAt]
    );

    await sendPasswordResetEmail(email.toLowerCase(), resetToken);

    return res.status(200).json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ success: false, message: 'Request failed. Please try again.' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    const result = await pool.query(
      `SELECT * FROM password_reset_tokens WHERE token = $1 AND used = FALSE AND expires_at > NOW()`,
      [token]
    );

    if (!result.rows.length) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset link' });
    }

    const record = result.rows[0];
    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, record.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [record.id]);
    await pool.query('UPDATE users SET refresh_token = NULL WHERE id = $1', [record.user_id]);

    return res.status(200).json({ success: true, message: 'Password reset successfully. Please log in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ success: false, message: 'Reset failed. Please try again.' });
  }
};

const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Refresh token required' });
    }

    const decoded = verifyToken(token);

    const result = await pool.query(
      'SELECT id, refresh_token, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!result.rows.length || result.rows[0].refresh_token !== token) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(401).json({ success: false, message: 'Account deactivated' });
    }

    const newAccessToken = generateAccessToken(user.id);
    const newRefreshToken = generateRefreshToken(user.id);

    await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [newRefreshToken, user.id]);

    return res.status(200).json({
      success: true,
      data: { accessToken: newAccessToken, refreshToken: newRefreshToken },
    });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
  }
};

const logout = async (req, res) => {
  try {
    await pool.query('UPDATE users SET refresh_token = NULL WHERE id = $1', [req.user.id]);
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ success: false, message: 'Logout failed' });
  }
};

const getMe = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.is_verified, u.is_18_confirmed, u.created_at,
              u.first_name AS "firstName",
              p.notification_new_match, p.email_notifications, p.push_notifications
       FROM users u
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({ success: true, data: { user: result.rows[0] } });
  } catch (err) {
    console.error('Get me error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
};

module.exports = { register, login, verifyEmail, resendVerification, forgotPassword, resetPassword, refreshToken, logout, getMe };
