const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/matches.controller');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, ctrl.getMatches);
router.get('/:id', authenticate, ctrl.getMatch);
router.delete('/:id', authenticate, ctrl.hideMatch);

module.exports = router;
