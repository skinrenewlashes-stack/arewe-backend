const pool = require('../config/db');
const { computeMatch } = require('../utils/matching');
const { notifyNewMatch } = require('../utils/notifications');

const createSubmission = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      firstName,
      ageRange,
      city,
      stateProvince,
      race,
      industry,
      carModel,
      lifestyleHabits,
    } = req.body;

    const userId = req.user.id;

    await client.query('BEGIN');

    const subResult = await client.query(
      `INSERT INTO submissions
         (user_id, first_name, age_range, city, state_province, race, industry, car_model, lifestyle_habits)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        userId,
        firstName.trim(),
        ageRange,
        city.trim(),
        stateProvince.trim(),
        race,
        industry?.trim() || null,
        carModel?.trim() || null,
        lifestyleHabits && lifestyleHabits.length > 0 ? lifestyleHabits : null,
      ]
    );

    const newSub = subResult.rows[0];

    // Run matching against all active submissions from OTHER users
    const otherSubs = await client.query(
      `SELECT s.* FROM submissions s
       WHERE s.user_id != $1
         AND s.is_active = TRUE
         AND s.user_id NOT IN (
           SELECT blocked_id FROM blocked_users WHERE blocker_id = $1
           UNION
           SELECT blocker_id FROM blocked_users WHERE blocked_id = $1
         )`,
      [userId]
    );

    const newMatches = [];

    for (const otherSub of otherSubs.rows) {
      // Skip if a match already exists between these two submissions
      const existing = await client.query(
        `SELECT id FROM matches
         WHERE (submission_a_id = $1 AND submission_b_id = $2)
            OR (submission_a_id = $2 AND submission_b_id = $1)`,
        [newSub.id, otherSub.id]
      );
      if (existing.rows.length > 0) continue;

      const { percentage, tier, breakdown } = computeMatch(newSub, otherSub);

      // Only store matches with at least some similarity
      if (percentage < 10) continue;

      const matchResult = await client.query(
        `INSERT INTO matches
           (submission_a_id, submission_b_id, user_a_id, user_b_id,
            percentage, tier, breakdown)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, percentage, tier`,
        [
          newSub.id,
          otherSub.id,
          userId,
          otherSub.user_id,
          percentage,
          tier,
          JSON.stringify(breakdown),
        ]
      );

      newMatches.push(matchResult.rows[0]);

      // Notify both users asynchronously
      notifyNewMatch(userId, percentage).catch(() => {});
      notifyNewMatch(otherSub.user_id, percentage).catch(() => {});
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Submission created and matching complete.',
      data: {
        submission: newSub,
        matchesFound: newMatches.length,
        topMatch: newMatches.sort((a, b) => b.percentage - a.percentage)[0] || null,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create submission error:', err);
    return res.status(500).json({ success: false, message: 'Submission failed. Please try again.' });
  } finally {
    client.release();
  }
};

const getSubmissions = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM submissions WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at DESC`,
      [req.user.id]
    );
    return res.json({ success: true, data: { submissions: result.rows } });
  } catch (err) {
    console.error('Get submissions error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch submissions.' });
  }
};

const getSubmission = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM submissions WHERE id = $1 AND user_id = $2 AND is_active = TRUE`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }
    return res.json({ success: true, data: { submission: result.rows[0] } });
  } catch (err) {
    console.error('Get submission error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch submission.' });
  }
};

const deleteSubmission = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id FROM submissions WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }
    // Soft delete
    await client.query(
      `UPDATE submissions SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    // Deactivate associated matches
    await client.query(
      `UPDATE matches SET is_active = FALSE, updated_at = NOW()
       WHERE submission_a_id = $1 OR submission_b_id = $1`,
      [req.params.id]
    );
    await client.query('COMMIT');
    return res.json({ success: true, message: 'Submission deleted.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete submission error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete submission.' });
  } finally {
    client.release();
  }
};

module.exports = { createSubmission, getSubmissions, getSubmission, deleteSubmission };
