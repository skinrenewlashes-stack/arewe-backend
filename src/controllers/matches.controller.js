const pool = require('../config/db');

const getMatches = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `WITH visible_matches AS (
         SELECT
           m.id,
           m.percentage,
           m.tier,
           m.submission_a_id,
           m.submission_b_id,
           m.user_a_id,
           m.user_b_id,
           m.user_a_unlocked,
           m.user_b_unlocked,
           m.is_active,
           m.created_at,
           LEAST(m.submission_a_id::text, m.submission_b_id::text) AS pair_low,
           GREATEST(m.submission_a_id::text, m.submission_b_id::text) AS pair_high,
           CASE WHEN m.user_a_id = $1 THEN m.user_a_unlocked
                ELSE m.user_b_unlocked END AS is_unlocked,
           CASE WHEN m.user_a_id = $1 THEN m.submission_a_id
                ELSE m.submission_b_id END AS my_submission_id,
           CASE WHEN m.user_a_id = $1 THEN m.submission_b_id
                ELSE m.submission_a_id END AS other_submission_id
         FROM matches m
         JOIN submissions sa ON sa.id = m.submission_a_id
         JOIN submissions sb ON sb.id = m.submission_b_id
         JOIN users ua ON ua.id = m.user_a_id
         JOIN users ub ON ub.id = m.user_b_id
         WHERE (
             (m.user_a_id = $1 AND sa.user_id = $1 AND COALESCE(m.hidden_by_user_a, FALSE) = FALSE)
             OR (m.user_b_id = $1 AND sb.user_id = $1 AND COALESCE(m.hidden_by_user_b, FALSE) = FALSE)
           )
           AND m.is_active = TRUE
           AND sa.is_active = TRUE
           AND sb.is_active = TRUE
           AND ua.is_active = TRUE
           AND ub.is_active = TRUE
           AND m.user_a_id = sa.user_id
           AND m.user_b_id = sb.user_id
       ),
       deduped_matches AS (
         SELECT DISTINCT ON (pair_low, pair_high) *
         FROM visible_matches
         ORDER BY pair_low, pair_high, is_unlocked DESC, percentage DESC, created_at DESC
       )
       SELECT
         id,
         percentage,
         tier,
         submission_a_id,
         submission_b_id,
         user_a_id,
         user_b_id,
         user_a_unlocked,
         user_b_unlocked,
         is_active,
         created_at,
         is_unlocked,
         my_submission_id,
         other_submission_id
       FROM deduped_matches
       ORDER BY percentage DESC, created_at DESC`,
      [userId]
    );

    return res.json({ success: true, data: { currentUserId: userId, matches: result.rows } });
  } catch (err) {
    console.error('Get matches error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch matches.' });
  }
};

const getMatch = async (req, res) => {
  try {
    const userId = req.user.id;
    const matchId = req.params.id;

    const result = await pool.query(
      `SELECT
         m.id,
         m.percentage,
         m.tier,
         m.submission_a_id,
         m.submission_b_id,
         m.user_a_id,
         m.user_b_id,
         m.user_a_unlocked,
         m.user_b_unlocked,
         m.created_at,
         CASE WHEN m.user_a_id = $1 THEN m.user_a_unlocked
              ELSE m.user_b_unlocked END AS is_unlocked,
         CASE WHEN m.user_a_id = $1 THEN m.submission_a_id
              ELSE m.submission_b_id END AS my_submission_id
       FROM matches m
       JOIN submissions sa ON sa.id = m.submission_a_id
       JOIN submissions sb ON sb.id = m.submission_b_id
       JOIN users ua ON ua.id = m.user_a_id
       JOIN users ub ON ub.id = m.user_b_id
       WHERE m.id = $2
         AND (
           (m.user_a_id = $1 AND sa.user_id = $1 AND COALESCE(m.hidden_by_user_a, FALSE) = FALSE)
           OR (m.user_b_id = $1 AND sb.user_id = $1 AND COALESCE(m.hidden_by_user_b, FALSE) = FALSE)
         )
         AND m.is_active = TRUE
         AND sa.is_active = TRUE
         AND sb.is_active = TRUE
         AND ua.is_active = TRUE
         AND ub.is_active = TRUE
         AND m.user_a_id = sa.user_id
         AND m.user_b_id = sb.user_id`,
      [userId, matchId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    const match = result.rows[0];

    // Only return breakdown if this user has unlocked
    const responseData = {
      id: match.id,
      percentage: match.percentage,
      tier: match.tier,
      submissionAId: match.submission_a_id,
      submissionBId: match.submission_b_id,
      isUnlocked: match.is_unlocked,
      createdAt: match.created_at,
      mySubmissionId: match.my_submission_id,
    };

    if (match.is_unlocked) {
      const full = await pool.query('SELECT breakdown FROM matches WHERE id = $1', [matchId]);
      responseData.breakdown = full.rows[0]?.breakdown || {};
    }

    return res.json({ success: true, data: { match: responseData } });
  } catch (err) {
    console.error('Get match error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch match.' });
  }
};

const hideMatch = async (req, res) => {
  try {
    const userId = req.user.id;
    const matchId = req.params.id;

    const result = await pool.query(
      `SELECT id, user_a_id, user_b_id
       FROM matches
       WHERE id = $1
         AND is_active = TRUE`,
      [matchId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    const match = result.rows[0];
    let hiddenColumn;

    if (match.user_a_id === userId) {
      hiddenColumn = 'hidden_by_user_a';
    } else if (match.user_b_id === userId) {
      hiddenColumn = 'hidden_by_user_b';
    } else {
      return res.status(403).json({ success: false, message: 'You do not have access to this match.' });
    }

    await pool.query(
      `UPDATE matches
       SET ${hiddenColumn} = TRUE,
           updated_at = NOW()
       WHERE id = $1`,
      [matchId]
    );

    return res.json({ success: true, data: { matchId, hidden: true } });
  } catch (err) {
    console.error('Hide match error:', err);
    return res.status(500).json({ success: false, message: 'Failed to remove match.' });
  }
};

module.exports = { getMatches, getMatch, hideMatch };
