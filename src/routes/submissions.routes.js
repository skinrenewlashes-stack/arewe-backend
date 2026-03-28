const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();
const ctrl = require('../controllers/submissions.controller');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.post('/',
  authenticate,
  [
    body('firstName').trim().isLength({ min: 2 }).withMessage('First name required'),
    body('ageRange').notEmpty().withMessage('Age range required'),
    body('city').trim().notEmpty().withMessage('City required'),
    body('stateProvince').trim().notEmpty().withMessage('State/province required'),
    body('race').notEmpty().withMessage('Race required'),
  ],
  validate,
  ctrl.createSubmission
);

router.get('/', authenticate, ctrl.getSubmissions);
router.get('/:id', authenticate, ctrl.getSubmission);
router.delete('/:id', authenticate, ctrl.deleteSubmission);

module.exports = router;
