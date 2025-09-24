const express = require('express');
const {
  createReport,
  getReports,
  getReport,
  updateReportStatus,
  deleteReport,
  getUserReports,
  getReportStats,
  upvoteReport,
  assignDepartment// --- NEW ---
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/authMiddleware');
const router = express.Router();

// Publicly viewable reports
router.route('/').get(getReports);

// --- NEW UPVOTE ROUTE ---
// Must be authenticated to upvote
router.route('/:id/upvote').put(protect, upvoteReport);

// All other routes that modify data are protected
router.route('/')
  .post(protect, createReport);
router.route('/my-reports').get(protect, getUserReports);

router.route('/stats').get(protect, authorize('admin'), getReportStats);

router.route('/:id/assign').put(protect, authorize('admin'), assignDepartment);

router.route('/:id')
  .get(getReport)
  .put(protect, authorize('admin'), updateReportStatus)
  .delete(protect, deleteReport);

module.exports = router;