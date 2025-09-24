const express = require('express');
const {
  createReport,
  getReports,
  getReport,
  updateReportStatus,
  deleteReport,
  getUserReports,
  getReportStats,
  updateUserReportImage, // New
  deleteReportImage     // New
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/authMiddleware');
const router = express.Router();

// Public route to view all reports on the map
router.route('/').get(getReports);

// All routes below are protected
router.use(protect);

router.route('/').post(createReport);
router.route('/my-reports').get(getUserReports);

// Image management routes for a specific report
router.route('/:id/image')
  .put(updateUserReportImage)     // User replaces their image
  .delete(deleteReportImage);   // User or Admin deletes an image

// Admin-only routes
router.route('/stats').get(authorize('admin'), getReportStats);

router.route('/:id')
  .get(getReport) // Can be accessed by user or admin
  .put(authorize('admin'), updateReportStatus)
  .delete(authorize('admin'), deleteReport);

module.exports = router;