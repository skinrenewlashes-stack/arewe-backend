const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const ctrl = require('../controllers/connections.controller');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.post('/request',
  authenticate,
  [body('matchId').notEmpty().withMessage('Match ID required')],
  validate,
  ctrl.sendRequest
);

router.get('/requests', authenticate, ctrl.getRequests);
router.get('/active', authenticate, ctrl.getActiveConnections);

router.post('/:id/respond',
  authenticate,
  [body('action').isIn(['accept', 'decline']).withMessage('Action must be accept or decline')],
  validate,
  ctrl.respondToRequest
);

router.post('/:id/share',
  authenticate,
  [body('contactInfo').isArray({ min: 1 }).withMessage('Select at least one contact option')],
  validate,
  ctrl.shareContact
);

module.exports = router;
