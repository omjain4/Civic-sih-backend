const express = require('express');
const {
  checkDuplicate,
  analyzeImageMetadata,
  matchDescription,
  fullAnalysis
} = require('../controllers/aiController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// All AI routes require authentication
router.post('/check-duplicate', protect, checkDuplicate);
router.post('/analyze-image', protect, analyzeImageMetadata);
router.post('/match-description', protect, matchDescription);
router.post('/full-analysis', protect, fullAnalysis);

module.exports = router;
