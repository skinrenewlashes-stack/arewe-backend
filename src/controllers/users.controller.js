const pool = require('../config/db');

const getProfile = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.is_verified, u.is_18_confirmed, u.created_at,
              u.first_name AS "firstName",
              p.notification_new_match, p.notification_connection_request,
              p.notification_payment_required, p.notification_request_accepted,
              p.notification_request_declined, p.notification_request_expired,
              p.notification_contact_exchange, p.email_notifications, p.push_notifications
       FROM users u
       LEFT JOIN user_profiles p ON u.id = p.user_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.json({ success: true, data: { user: result.rows[0] } });
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch profile.' });
  }
};

const updateNotifications = async (req, res) => {
  try {
    const {
      push_notifications,
      email_notifications,
      notification_new_match,
      notification_connection_request,
      notification_payment_required,
      notification_request_accepted,
      notification_request_declined,
      notification_request_expired,
      notification_contact_exchange,
    } = req.body;

    await pool.query(
      `INSERT INTO user_profiles (user_id, push_notifications, email_notifications,
         notification_new_match, notification_connection_request, notification_payment_required,
         notification_request_accepted, notification_request_declined, notification_request_expired,
         notification_contact_exchange)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id) DO UPDATE SET
         push_notifications = COALESCE($2, user_profiles.push_notifications),
         email_notifications = COALESCE($3, user_profiles.email_notifications),
         notification_new_match = COALESCE($4, user_profiles.notification_new_match),
         notification_connection_request = COALESCE($5, user_profiles.notification_connection_request),
         notification_payment_required = COALESCE($6, user_profiles.notification_payment_required),
         notification_request_accepted = COALESCE($7, user_profiles.notification_request_accepted),
         notification_request_declined = COALESCE($8, user_profiles.notification_request_declined),
         notification_request_expired = COALESCE($9, user_profiles.notification_request_expired),
         notification_contact_exchange = COALESCE($10, user_profiles.notification_contact_exchange),
         updated_at = NOW()`,
      [
        req.user.id,
        push_notifications ?? null,
        email_notifications ?? null,
        notification_new_match ?? null,
        notification_connection_request ?? null,
        notification_payment_required ?? null,
        notification_request_accepted ?? null,
        notification_request_declined ?? null,
        notification_request_expired ?? null,
        notification_contact_exchange ?? null,
      ]
    );

    return res.json({ success: true, message: 'Notification preferences updated.' });
  } catch (err) {
    console.error('Update notifications error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update preferences.' });
  }
};

const updatePushToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Push token required.' });
    await pool.query(
      'UPDATE users SET push_token = $1, updated_at = NOW() WHERE id = $2',
      [token, req.user.id]
    );
    return res.json({ success: true, message: 'Push token updated.' });
  } catch (err) {
    console.error('Update push token error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update push token.' });
  }
};

const deleteAccount = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userId = req.user.id;

    // Soft delete: anonymize and deactivate — keep rows for data integrity
    await client.query(
      `UPDATE users
       SET email = $1, password_hash = '', first_name = NULL, is_active = FALSE,
           refresh_token = NULL, push_token = NULL, updated_at = NOW()
       WHERE id = $2`,
      [`deleted_${userId}@arewe.deleted`, userId]
    );

    await client.query(
      'UPDATE submissions SET is_active = FALSE, updated_at = NOW() WHERE user_id = $1',
      [userId]
    );

    await client.query(
      `UPDATE matches SET is_active = FALSE, updated_at = NOW()
       WHERE user_a_id = $1 OR user_b_id = $1`,
      [userId]
    );

    await client.query('COMMIT');
    return res.json({ success: true, message: 'Account deleted successfully.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete account error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete account.' });
  } finally {
    client.release();
  }
};

const blockUser = async (req, res) => {
  try {
    const blockerId = req.user.id;
    const blockedId = req.params.userId;

    if (blockerId === blockedId) {
      return res.status(400).json({ success: false, message: 'You cannot block yourself.' });
    }

    const userExists = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND is_active = TRUE',
      [blockedId]
    );
    if (!userExists.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    await pool.query(
      `INSERT INTO blocked_users (blocker_id, blocked_id) VALUES ($1,$2)
       ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
      [blockerId, blockedId]
    );

    return res.json({ success: true, message: 'User blocked.' });
  } catch (err) {
    console.error('Block user error:', err);
    return res.status(500).json({ success: false, message: 'Failed to block user.' });
  }
};

const reportUser = async (req, res) => {
  try {
    const reporterId = req.user.id;
    const reportedId = req.params.userId;
    const { reason, additionalInfo } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Reason is required.' });
    }

    if (reporterId === reportedId) {
      return res.status(400).json({ success: false, message: 'You cannot report yourself.' });
    }

    await pool.query(
      `INSERT INTO reports (reporter_id, reported_user_id, reason, additional_info)
       VALUES ($1,$2,$3,$4)`,
      [reporterId, reportedId, reason, additionalInfo || null]
    );

    return res.json({ success: true, message: 'Report submitted. Our team will review it.' });
  } catch (err) {
    console.error('Report user error:', err);
    return res.status(500).json({ success: false, message: 'Failed to submit report.' });
  }
};

module.exports = {
  getProfile,
  updateNotifications,
  updatePushToken,
  deleteAccount,
  blockUser,
  reportUser,
};
