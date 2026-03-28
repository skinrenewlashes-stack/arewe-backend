const pool = require('../config/db');
const {
  notifyConnectionRequest,
  notifyPaymentRequired,
  notifyRequestAccepted,
  notifyRequestDeclined,
  notifyContactExchange,
} = require('../utils/notifications');

/**
 * User A sends a connection request after unlocking.
 * - Validates User A has paid for this match
 * - Creates connection_request with status 'payment_required' for User B
 * - Notifies User B
 */
const sendRequest = async (req, res) => {
  const client = await pool.connect();
  try {
    const requesterId = req.user.id;
    const { matchId } = req.body;

    if (!matchId) {
      return res.status(400).json({ success: false, message: 'Match ID is required.' });
    }

    // Verify match and requester participation
    const matchResult = await client.query(
      `SELECT id, user_a_id, user_b_id, user_a_unlocked, user_b_unlocked
       FROM matches WHERE id = $1 AND is_active = TRUE`,
      [matchId]
    );

    if (!matchResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    const match = matchResult.rows[0];
    const isUserA = match.user_a_id === requesterId;
    const isUserB = match.user_b_id === requesterId;

    if (!isUserA && !isUserB) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    // Verify requester has unlocked (paid)
    const requesterUnlocked = isUserA ? match.user_a_unlocked : match.user_b_unlocked;
    if (!requesterUnlocked) {
      return res.status(403).json({
        success: false,
        message: 'You must unlock this match before sending a connection request.',
      });
    }

    const recipientId = isUserA ? match.user_b_id : match.user_a_id;

    // Check if request already exists
    const existing = await client.query(
      `SELECT id, status FROM connection_requests
       WHERE match_id = $1 AND requester_id = $2`,
      [matchId, requesterId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'A connection request already exists for this match.',
        data: { requestId: existing.rows[0].id, status: existing.rows[0].status },
      });
    }

    await client.query('BEGIN');

    // Determine initial status based on whether recipient has already paid
    const recipientUnlocked = isUserA ? match.user_b_unlocked : match.user_a_unlocked;
    const initialStatus = recipientUnlocked ? 'pending' : 'payment_required';

    const reqResult = await client.query(
      `INSERT INTO connection_requests
         (match_id, requester_id, recipient_id, status, expires_at)
       VALUES ($1,$2,$3,$4, NOW() + INTERVAL '7 days')
       RETURNING *`,
      [matchId, requesterId, recipientId, initialStatus]
    );

    const request = reqResult.rows[0];

    await client.query('COMMIT');

    // Notify recipient
    if (initialStatus === 'payment_required') {
      notifyPaymentRequired(recipientId).catch(() => {});
    } else {
      notifyConnectionRequest(recipientId).catch(() => {});
    }

    return res.status(201).json({
      success: true,
      message: 'Connection request sent.',
      data: { request },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Send request error:', err);
    return res.status(500).json({ success: false, message: 'Failed to send request.' });
  } finally {
    client.release();
  }
};

/**
 * Get all connection requests for the current user (sent + received)
 */
const getRequests = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT
         cr.id,
         cr.match_id,
         cr.status,
         cr.expires_at,
         cr.exchange_completed,
         cr.created_at,
         m.percentage AS match_percentage,
         CASE WHEN cr.requester_id = $1 THEN 'outgoing' ELSE 'incoming' END AS direction
       FROM connection_requests cr
       JOIN matches m ON cr.match_id = m.id
       WHERE cr.requester_id = $1 OR cr.recipient_id = $1
       ORDER BY cr.created_at DESC`,
      [userId]
    );

    // Auto-expire stale requests
    await pool.query(
      `UPDATE connection_requests
       SET status = 'expired', updated_at = NOW()
       WHERE status IN ('pending','payment_required')
         AND expires_at < NOW()`,
    );

    return res.json({ success: true, data: { requests: result.rows } });
  } catch (err) {
    console.error('Get requests error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch requests.' });
  }
};

/**
 * User B responds to a connection request (accept or decline).
 * - Validates recipient identity and payment
 * - On accept: updates status to 'accepted', notifies requester
 * - On decline: updates status to 'declined', notifies requester
 */
const respondToRequest = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const requestId = req.params.id;
    const { action } = req.body;

    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be accept or decline.' });
    }

    const reqResult = await client.query(
      `SELECT cr.*, m.user_a_id, m.user_b_id, m.user_a_unlocked, m.user_b_unlocked
       FROM connection_requests cr
       JOIN matches m ON cr.match_id = m.id
       WHERE cr.id = $1 AND cr.recipient_id = $2`,
      [requestId, userId]
    );

    if (!reqResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Request not found.' });
    }

    const request = reqResult.rows[0];

    if (request.status === 'expired') {
      return res.status(400).json({ success: false, message: 'This request has expired.' });
    }
    if (request.status === 'accepted' || request.status === 'declined') {
      return res.status(400).json({ success: false, message: 'Request already responded to.' });
    }
    if (request.status === 'payment_required') {
      return res.status(403).json({
        success: false,
        message: 'Payment required before responding.',
      });
    }

    // Verify recipient has unlocked (paid)
    const isUserA = request.user_a_id === userId;
    const recipientUnlocked = isUserA ? request.user_a_unlocked : request.user_b_unlocked;
    if (!recipientUnlocked) {
      return res.status(403).json({
        success: false,
        message: 'You must unlock this match before responding.',
      });
    }

    await client.query('BEGIN');

    const newStatus = action === 'accept' ? 'accepted' : 'declined';

    await client.query(
      `UPDATE connection_requests SET status = $1, updated_at = NOW() WHERE id = $2`,
      [newStatus, requestId]
    );

    await client.query('COMMIT');

    if (newStatus === 'accepted') {
      notifyRequestAccepted(request.requester_id).catch(() => {});
    } else {
      notifyRequestDeclined(request.requester_id).catch(() => {});
    }

    return res.json({
      success: true,
      message: newStatus === 'accepted' ? 'Request accepted.' : 'Request declined.',
      data: { status: newStatus, requestId },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Respond to request error:', err);
    return res.status(500).json({ success: false, message: 'Failed to respond to request.' });
  } finally {
    client.release();
  }
};

/**
 * User shares their chosen contact info.
 * Once both users have shared, mark exchange as complete and notify both.
 */
const shareContact = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const requestId = req.params.id;
    const { contactInfo } = req.body;

    if (!contactInfo || !Array.isArray(contactInfo) || contactInfo.length === 0) {
      return res.status(400).json({ success: false, message: 'Contact info is required.' });
    }

    const VALID_KEYS = ['email', 'phone', 'instagram', 'otherSocial'];
    const validInfo = contactInfo.filter((k) => VALID_KEYS.includes(k));
    if (validInfo.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid contact options selected.' });
    }

    const reqResult = await client.query(
      `SELECT cr.*, u_req.email AS requester_email, u_rec.email AS recipient_email
       FROM connection_requests cr
       JOIN users u_req ON cr.requester_id = u_req.id
       JOIN users u_rec ON cr.recipient_id = u_rec.id
       WHERE cr.id = $1
         AND (cr.requester_id = $2 OR cr.recipient_id = $2)
         AND cr.status = 'accepted'`,
      [requestId, userId]
    );

    if (!reqResult.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'Request not found or not in accepted state.',
      });
    }

    const request = reqResult.rows[0];
    const isRequester = request.requester_id === userId;

    await client.query('BEGIN');

    // Store this user's chosen contact fields
    const shareCol = isRequester ? 'requester_shared' : 'recipient_shared';
    await client.query(
      `UPDATE connection_requests SET ${shareCol} = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify({ fields: validInfo }), requestId]
    );

    // Re-fetch to check if both have shared
    const updated = await client.query(
      `SELECT requester_shared, recipient_shared FROM connection_requests WHERE id = $1`,
      [requestId]
    );

    const row = updated.rows[0];
    const bothShared = row.requester_shared && row.recipient_shared;

    if (bothShared) {
      await client.query(
        `UPDATE connection_requests
         SET exchange_completed = TRUE, exchange_completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [requestId]
      );

      notifyContactExchange(request.requester_id).catch(() => {});
      notifyContactExchange(request.recipient_id).catch(() => {});
    }

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: bothShared
        ? 'Contact information exchanged. Connection completed.'
        : 'Your contact selection saved. Waiting for the other user.',
      data: { exchangeCompleted: bothShared },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Share contact error:', err);
    return res.status(500).json({ success: false, message: 'Failed to share contact info.' });
  } finally {
    client.release();
  }
};

const getActiveConnections = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT cr.id, cr.exchange_completed, cr.exchange_completed_at,
              cr.requester_shared, cr.recipient_shared, cr.created_at,
              m.percentage AS match_percentage,
              CASE WHEN cr.requester_id = $1 THEN 'outgoing' ELSE 'incoming' END AS direction
       FROM connection_requests cr
       JOIN matches m ON cr.match_id = m.id
       WHERE (cr.requester_id = $1 OR cr.recipient_id = $1)
         AND cr.status = 'accepted'
       ORDER BY cr.updated_at DESC`,
      [userId]
    );
    return res.json({ success: true, data: { connections: result.rows } });
  } catch (err) {
    console.error('Get active connections error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch connections.' });
  }
};

module.exports = { sendRequest, getRequests, respondToRequest, shareContact, getActiveConnections };
