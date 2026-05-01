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

    return res.status(201).json({
      success: true,
      message: 'Account created. Please verify your email before logging in.',
      data: {
        user: { id: user.id, firstName: user.first_name, email: user.email, isVerified: false, is18Confirmed: true },
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

    if (!user.is_verified) {
      return res.status(403).json({ success: false, message: 'Please verify your email before logging in.' });
    }

    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, token_type, expires_at)
       VALUES ($1, $2, 'session', NOW() + INTERVAL '30 days')`,
      [user.id, refreshToken]
    );

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

const renderEmailVerificationPage = ({ title, message }) => `
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}</title>
    </head>
    <body style="margin:0;background:#050505;color:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
      <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
        <section style="max-width:520px;width:100%;background:#0d0d0d;border:1px solid #2a2415;border-radius:12px;padding:36px 28px;text-align:center;">
          <div style="color:#D4AF37;font-size:28px;font-weight:700;margin-bottom:8px;">AreWe?</div>
          <h1 style="margin:0 0 16px;color:#ffffff;font-size:26px;line-height:1.25;">${title}</h1>
          <p style="margin:0;color:#d8d8d8;font-size:16px;line-height:1.6;">${message}</p>
        </section>
      </main>
    </body>
  </html>
`;

const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    const result = await pool.query(
      `SELECT * FROM email_verification_tokens WHERE token = $1 AND used = FALSE AND expires_at > NOW()`,
      [token]
    );

    if (!result.rows.length) {
      return res.status(400).type('html').send(renderEmailVerificationPage({
        title: 'Verification link unavailable',
        message: 'This verification link is invalid or has expired. Please return to the AreWe? app and request a new verification email.',
      }));
    }

    const record = result.rows[0];

    await pool.query('UPDATE users SET is_verified = TRUE, updated_at = NOW() WHERE id = $1', [record.user_id]);
    await pool.query('UPDATE email_verification_tokens SET used = TRUE WHERE id = $1', [record.id]);

    return res.status(200).type('html').send(renderEmailVerificationPage({
      title: 'Email verified',
      message: 'Your email has been verified successfully. You can now return to the AreWe? app and log in.',
    }));
  } catch (err) {
    console.error('Verify email error:', err);
    return res.status(500).type('html').send(renderEmailVerificationPage({
      title: 'Verification failed',
      message: 'We could not verify your email right now. Please return to the AreWe? app and try again.',
    }));
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

    const tokenResult = await pool.query(
      `SELECT rt.id AS token_id, rt.token_type, rt.user_id, u.id, u.is_active, u.is_blocked
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token = $1
         AND rt.user_id = $2
         AND rt.is_revoked = FALSE
         AND rt.expires_at > NOW()`,
      [token, decoded.userId]
    );

    if (tokenResult.rows.length) {
      const user = tokenResult.rows[0];

      if (!user.is_active) {
        return res.status(401).json({ success: false, message: 'Account deactivated' });
      }

      if (user.is_blocked) {
        return res.status(403).json({ success: false, message: 'Account suspended' });
      }

      const newAccessToken = generateAccessToken(user.id);
      const newRefreshToken = generateRefreshToken(user.id);

      await pool.query(
        'UPDATE refresh_tokens SET is_revoked = TRUE, updated_at = NOW() WHERE id = $1',
        [user.token_id]
      );
      await pool.query(
        `INSERT INTO refresh_tokens (user_id, token, token_type, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')`,
        [user.id, newRefreshToken, user.token_type]
      );
      await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [newRefreshToken, user.id]);

      return res.status(200).json({
        success: true,
        data: { accessToken: newAccessToken, refreshToken: newRefreshToken },
      });
    }

    const result = await pool.query(
      'SELECT id, refresh_token, is_active, is_blocked FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!result.rows.length || result.rows[0].refresh_token !== token) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(401).json({ success: false, message: 'Account deactivated' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ success: false, message: 'Account suspended' });
    }

    const newAccessToken = generateAccessToken(user.id);
    const newRefreshToken = generateRefreshToken(user.id);

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, token_type, expires_at)
       VALUES ($1, $2, 'session', NOW() + INTERVAL '30 days')`,
      [user.id, newRefreshToken]
    );
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
    await pool.query(
      `UPDATE refresh_tokens
       SET is_revoked = TRUE,
           revoked_at = NOW(),
           updated_at = NOW()
       WHERE user_id = $1
       AND token_type = 'session'
       AND is_revoked = FALSE`,
      [req.user.id]
    );
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ success: false, message: 'Logout failed' });
  }
};

const enableBiometric = async (req, res) => {
  try {
    const newRefreshToken = generateRefreshToken(req.user.id);

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, token_type, expires_at)
       VALUES ($1, $2, 'biometric', NOW() + INTERVAL '30 days')`,
      [req.user.id, newRefreshToken]
    );

    return res.status(200).json({
      success: true,
      data: {
        refreshToken: newRefreshToken,
      },
    });
  } catch (err) {
    console.error('Enable biometric error:', err);
    return res.status(500).json({ success: false, message: 'Could not enable biometric login' });
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

    const user = result.rows[0];

    return res.status(200).json({
      success: true,
      data: {
        user: {
          ...user,
          isVerified: user.is_verified,
        },
      },
    });
  } catch (err) {
    console.error('Get me error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
};

module.exports = { register, login, verifyEmail, resendVerification, forgotPassword, resetPassword, refreshToken, logout, enableBiometric, getMe };
