const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const ctrl = require('../controllers/payments.controller');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');

// Stripe webhook — raw body required, no auth middleware
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  ctrl.stripeWebhook
);

router.post('/intent',
  authenticate,
  [body('matchId').notEmpty().withMessage('Match ID required')],
  validate,
  ctrl.createPaymentIntent
);

router.post('/confirm',
  authenticate,
  [body('paymentIntentId').notEmpty().withMessage('Payment intent ID required')],
  validate,
  ctrl.confirmPayment
);

module.exports = router;
