const express = require('express');
const {
  createReport,
  getReports,
  getReport,
  updateReportStatus,
  deleteReport,
  getUserReports,
  getReportStats // Import the new function
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/authMiddleware');
const router = express.Router();

//router.use(protect); // All routes from here are protected

// Add the new stats route (must be before routes with /:id)
router.route('/stats').get(authorize('admin'), getReportStats);

router.route('/')
  .post(protect, createReport)  // POST (submit report) stays protected!
  .get(getReports);             // GET (view reports) is public


router.route('/my-reports').get(getUserReports);

router.route('/:id')
  .get(getReport)
  .put(authorize('admin'), updateReportStatus)
  .delete(authorize('admin'), deleteReport);

module.exports = router;