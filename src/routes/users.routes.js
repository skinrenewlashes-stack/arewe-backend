const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();
const ctrl = require('../controllers/users.controller');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.get('/profile', authenticate, ctrl.getProfile);

router.put('/notifications', authenticate, ctrl.updateNotifications);

router.put('/push-token',
  authenticate,
  [body('token').notEmpty().withMessage('Push token required')],
  validate,
  ctrl.updatePushToken
);

router.delete('/account', authenticate, ctrl.deleteAccount);

router.post('/:userId/block',
  authenticate,
  [param('userId').isUUID().withMessage('Valid user ID required')],
  validate,
  ctrl.blockUser
);

router.post('/:userId/report',
  authenticate,
  [
    param('userId').isUUID().withMessage('Valid user ID required'),
    body('reason').notEmpty().withMessage('Reason required'),
  ],
  validate,
  ctrl.reportUser
);

module.exports = router;
