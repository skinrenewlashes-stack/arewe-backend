const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');

const passwordRules = body('password')
  .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
  .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
  .matches(/[0-9]/).withMessage('Password must contain at least one number');

router.post('/register',
  [
    body('firstName').optional({ values: 'falsy' }).trim().isLength({ min: 1, max: 100 }).withMessage('First name must be between 1 and 100 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    passwordRules,
    body('is18Confirmed').isBoolean().equals('true').withMessage('You must confirm you are 18 or older'),
  ],
  validate,
  authController.register
);

router.post('/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required'),
  ],
  validate,
  authController.login
);

router.get('/verify-email/:token',
  [param('token').notEmpty().withMessage('Token required')],
  validate,
  authController.verifyEmail
);

router.post('/resend-verification',
  [body('email').isEmail().normalizeEmail().withMessage('Valid email required')],
  validate,
  authController.resendVerification
);

router.post('/forgot-password',
  [body('email').isEmail().normalizeEmail().withMessage('Valid email required')],
  validate,
  authController.forgotPassword
);

router.post('/reset-password',
  [
    body('token').notEmpty().withMessage('Reset token required'),
    passwordRules,
  ],
  validate,
  authController.resetPassword
);

router.get('/reset-password-redirect', authController.resetPasswordRedirect);

router.post('/refresh-token',
  [body('refreshToken').notEmpty().withMessage('Refresh token required')],
  validate,
  authController.refreshToken
);

router.post('/biometric/enable', authenticate, authController.enableBiometric);

router.post('/logout', authenticate, authController.logout);

router.get('/me', authenticate, authController.getMe);

module.exports = router;
