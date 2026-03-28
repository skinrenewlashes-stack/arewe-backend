const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../config/db');
const { notifyConnectionRequest, notifyPaymentRequired } = require('../utils/notifications');

/**
 * Create a Stripe PaymentIntent for a user to unlock a match.
 * - Checks user has not already paid for this match
 * - Creates a $4.99 PaymentIntent
 * - Returns clientSecret for frontend Stripe SDK to confirm payment
 */
const createPaymentIntent = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { matchId } = req.body;

    if (!matchId) {
      return res.status(400).json({ success: false, message: 'Match ID is required.' });
    }

    // Verify match exists and user is a participant
    const matchResult = await client.query(
      `SELECT id, user_a_id, user_b_id, user_a_unlocked, user_b_unlocked
       FROM matches WHERE id = $1 AND is_active = TRUE`,
      [matchId]
    );

    if (!matchResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Match not found.' });
    }

    const match = matchResult.rows[0];
    const isUserA = match.user_a_id === userId;
    const isUserB = match.user_b_id === userId;

    if (!isUserA && !isUserB) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const alreadyUnlocked = isUserA ? match.user_a_unlocked : match.user_b_unlocked;
    if (alreadyUnlocked) {
      return res.status(400).json({ success: false, message: 'You have already unlocked this match.' });
    }

    // Check if payment already exists (pending or succeeded)
    const existingPayment = await client.query(
      `SELECT id, status, stripe_client_secret FROM payments
       WHERE user_id = $1 AND match_id = $2`,
      [userId, matchId]
    );

    if (existingPayment.rows.length > 0) {
      const existing = existingPayment.rows[0];
      if (existing.status === 'succeeded') {
        return res.status(400).json({ success: false, message: 'Payment already completed.' });
      }
      // Return existing pending intent
      return res.json({
        success: true,
        data: {
          paymentIntentId: existing.id,
          clientSecret: existing.stripe_client_secret,
        },
      });
    }

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 499, // $4.99 in cents
      currency: 'usd',
      metadata: {
        userId,
        matchId,
        appName: 'AreWe?',
      },
      description: 'AreWe? match unlock — $4.99',
    });

    // Store payment record
    await client.query(
      `INSERT INTO payments
         (user_id, match_id, stripe_payment_intent_id, stripe_client_secret, amount_cents, status)
       VALUES ($1,$2,$3,$4,499,'pending')`,
      [userId, matchId, paymentIntent.id, paymentIntent.client_secret]
    );

    return res.status(201).json({
      success: true,
      data: {
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount: 4.99,
        currency: 'usd',
      },
    });
  } catch (err) {
    console.error('Create payment intent error:', err);
    return res.status(500).json({ success: false, message: 'Payment setup failed. Please try again.' });
  } finally {
    client.release();
  }
};

/**
 * Confirm payment after Stripe SDK confirms on frontend.
 * - Verifies PaymentIntent status with Stripe
 * - Marks user's side as unlocked in matches table
 * - Updates payment record to succeeded
 * - If a connection request exists with payment_required, updates it to pending
 */
const confirmPayment = async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ success: false, message: 'Payment intent ID required.' });
    }

    // Retrieve payment record
    const paymentResult = await client.query(
      `SELECT p.*, m.user_a_id, m.user_b_id
       FROM payments p
       JOIN matches m ON p.match_id = m.id
       WHERE p.stripe_payment_intent_id = $1 AND p.user_id = $2`,
      [paymentIntentId, userId]
    );

    if (!paymentResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' });
    }

    const payment = paymentResult.rows[0];

    if (payment.status === 'succeeded') {
      return res.json({ success: true, message: 'Payment already confirmed.' });
    }

    // Verify with Stripe
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.status !== 'succeeded') {
      await client.query(
        `UPDATE payments SET status = 'failed', updated_at = NOW()
         WHERE stripe_payment_intent_id = $1`,
        [paymentIntentId]
      );
      return res.status(400).json({
        success: false,
        message: `Payment not completed. Stripe status: ${intent.status}`,
      });
    }

    await client.query('BEGIN');

    // Mark payment succeeded
    await client.query(
      `UPDATE payments SET status = 'succeeded', updated_at = NOW()
       WHERE stripe_payment_intent_id = $1`,
      [paymentIntentId]
    );

    // Mark user's side as unlocked
    const isUserA = payment.user_a_id === userId;
    const unlockCol = isUserA ? 'user_a_unlocked' : 'user_b_unlocked';
    const unlockAtCol = isUserA ? 'user_a_unlocked_at' : 'user_b_unlocked_at';

    await client.query(
      `UPDATE matches
       SET ${unlockCol} = TRUE, ${unlockAtCol} = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [payment.match_id]
    );

    // Check if a connection request exists for this match with payment_required
    // and this user is the recipient — if so, move to pending so they can respond
    const reqResult = await client.query(
      `SELECT id, requester_id, recipient_id FROM connection_requests
       WHERE match_id = $1 AND recipient_id = $2 AND status = 'payment_required'`,
      [payment.match_id, userId]
    );

    if (reqResult.rows.length > 0) {
      await client.query(
        `UPDATE connection_requests SET status = 'pending', updated_at = NOW()
         WHERE id = $1`,
        [reqResult.rows[0].id]
      );
    }

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: 'Payment confirmed. Match unlocked.',
      data: { matchId: payment.match_id, unlocked: true },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Confirm payment error:', err);
    return res.status(500).json({ success: false, message: 'Payment confirmation failed.' });
  } finally {
    client.release();
  }
};

/**
 * Stripe webhook handler
 * Handles payment_intent.succeeded and payment_intent.payment_failed events
 */
const stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const client = await pool.connect();
  try {
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const { userId, matchId } = intent.metadata;

      if (!userId || !matchId) {
        return res.json({ received: true });
      }

      await client.query('BEGIN');

      await client.query(
        `UPDATE payments SET status = 'succeeded', updated_at = NOW()
         WHERE stripe_payment_intent_id = $1 AND status != 'succeeded'`,
        [intent.id]
      );

      const matchResult = await client.query(
        'SELECT user_a_id, user_b_id FROM matches WHERE id = $1',
        [matchId]
      );

      if (matchResult.rows.length > 0) {
        const match = matchResult.rows[0];
        const isUserA = match.user_a_id === userId;
        const unlockCol = isUserA ? 'user_a_unlocked' : 'user_b_unlocked';
        const unlockAtCol = isUserA ? 'user_a_unlocked_at' : 'user_b_unlocked_at';

        await client.query(
          `UPDATE matches SET ${unlockCol} = TRUE, ${unlockAtCol} = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [matchId]
        );

        const reqResult = await client.query(
          `SELECT id FROM connection_requests
           WHERE match_id = $1 AND recipient_id = $2 AND status = 'payment_required'`,
          [matchId, userId]
        );

        if (reqResult.rows.length > 0) {
          await client.query(
            `UPDATE connection_requests SET status = 'pending', updated_at = NOW()
             WHERE id = $1`,
            [reqResult.rows[0].id]
          );
        }
      }

      await client.query('COMMIT');
    }

    if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object;
      await client.query(
        `UPDATE payments SET status = 'failed', updated_at = NOW()
         WHERE stripe_payment_intent_id = $1`,
        [intent.id]
      );
    }

    return res.json({ received: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  } finally {
    client.release();
  }
};

module.exports = { createPaymentIntent, confirmPayment, stripeWebhook };
