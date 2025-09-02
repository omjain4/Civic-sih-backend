const Report = require('../models/Report');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const streamifier = require('streamifier');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Middleware to upload to Cloudinary
const uploadToCloudinary = (req, res, next) => {
  if (!req.file) {
    return next(); // No file uploaded, continue
  }

  const stream = cloudinary.uploader.upload_stream(
    { 
      folder: 'civic_issues',
      resource_type: 'auto'
    },
    (error, result) => {
      if (error) {
        console.error('Cloudinary upload error:', error);
        return res.status(500).json({ 
          success: false, 
          message: 'Image upload failed' 
        });
      }
      req.body.imageUrl = result.secure_url;
      next();
    }
  );

  streamifier.createReadStream(req.file.buffer).pipe(stream);
};

// @desc Create a new report with photo upload
// @route POST /api/reports
// @access Private
exports.createReport = [
  upload.single('photo'),
  uploadToCloudinary,
  async (req, res, next) => {
    try {
      const { category, address, description, latitude, longitude } = req.body;
      
      const reportData = {
        user: req.user.id,
        category,
        address,
        description,
        status: 'pending'
      };

      // Add image URL if uploaded
      if (req.body.imageUrl) {
        reportData.imageUrl = req.body.imageUrl;
      }

      // Add GPS coordinates if provided
      if (latitude && longitude) {
        reportData.location = {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        };
      }

      const report = await Report.create(reportData);

      res.status(201).json({
        success: true,
        data: report
      });
    } catch (error) {
      console.error('Create report error:', error);
      res.status(400).json({ 
        success: false, 
        message: error.message 
      });
    }
  }
];

// @desc Get all reports
// @route GET /api/reports
// @access Private
exports.getReports = async (req, res, next) => {
  try {
    const reports = await Report.find().populate('user', 'email');
    res.status(200).json({
      success: true,
      count: reports.length,
      data: reports
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc Get reports for the logged-in user
// @route GET /api/reports/my-reports
// @access Private
exports.getUserReports = async (req, res, next) => {
  try {
    const reports = await Report.find({ user: req.user.id });
    
    res.status(200).json({
      success: true,
      count: reports.length,
      data: reports
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc Get a single report
// @route GET /api/reports/:id
// @access Private
exports.getReport = async (req, res, next) => {
  try {
    const report = await Report.findById(req.params.id).populate('user', 'email');
    
    if (!report) {
      return res.status(404).json({ 
        success: false, 
        message: 'Report not found' 
      });
    }

    res.status(200).json({ 
      success: true, 
      data: report 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc Update report status
// @route PUT /api/reports/:id
// @access Private (Admin only)
exports.updateReportStatus = async (req, res, next) => {
  try {
    let report = await Report.findById(req.params.id);
    
    if (!report) {
      return res.status(404).json({ 
        success: false, 
        message: 'Report not found' 
      });
    }

    report = await Report.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    res.status(200).json({ 
      success: true, 
      data: report 
    });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc Delete a report
// @route DELETE /api/reports/:id
// @access Private (Admin only)
exports.deleteReport = async (req, res, next) => {
  try {
    const report = await Report.findById(req.params.id);
    
    if (!report) {
      return res.status(404).json({ 
        success: false, 
        message: 'Report not found' 
      });
    }

    // Delete image from Cloudinary if exists
    if (report.imageUrl) {
      const publicId = report.imageUrl.split('/').pop().split('.')[0];
      try {
        await cloudinary.uploader.destroy(`civic_issues/${publicId}`);
      } catch (error) {
        console.error('Error deleting image from Cloudinary:', error);
      }
    }

    await report.deleteOne();

    res.status(200).json({ 
      success: true, 
      data: {} 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc Get report statistics
// @route GET /api/reports/stats
// @access Private (Admin only)
exports.getReportStats = async (req, res, next) => {
  try {
    const totalIssues = Report.countDocuments();
    const pending = Report.countDocuments({ status: 'pending' });
    const inProgress = Report.countDocuments({ status: 'in-progress' });
    const resolved = Report.countDocuments({ status: 'resolved' });

    const [total, pendingCount, inProgressCount, resolvedCount] = await Promise.all([
      totalIssues,
      pending,
      inProgress,
      resolved
    ]);

    res.status(200).json({
      success: true,
      data: {
        total: total,
        pending: pendingCount,
        inProgress: inProgressCount,
        resolved: resolvedCount,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
