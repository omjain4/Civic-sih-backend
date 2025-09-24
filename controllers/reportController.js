const Report = require('../models/Report');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const streamifier = require('streamifier');

// Configure Cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Helper function to delete an image from Cloudinary
const deleteFromCloudinary = async (imageUrl) => {
  if (!imageUrl) return;
  try {
    const urlParts = imageUrl.split('/');
    // Assumes folder/public_id format, e.g., .../civic_issues/xyz.jpg
    const publicIdWithFolder = urlParts.slice(-2).join('/').split('.')[0];
    const result = await cloudinary.uploader.destroy(publicIdWithFolder);
    console.log('✅ Image deleted from Cloudinary:', result);
  } catch (cloudinaryError) {
    console.error('⚠️ Failed to delete image from Cloudinary:', cloudinaryError);
    // Do not throw error, just log it. The DB record can still be updated.
  }
};


// Configure multer for memory storage (better for cloud uploads)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB file size limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Middleware to upload and compress image to Cloudinary
const uploadToCloudinary = (req, res, next) => {
  if (!req.file) {
    console.log('📝 No file uploaded, continuing without image');
    return next();
  }

  console.log('📸 Starting Cloudinary upload process...');
  console.log('📊 Original file details:', {
    originalName: req.file.originalname,
    size: `${(req.file.size / 1024 / 1024).toFixed(2)}MB`,
    mimetype: req.file.mimetype
  });


  const uploadStart = Date.now();

  // Cloudinary upload with automatic optimization and compression
  const stream = cloudinary.uploader.upload_stream(
    {
      folder: 'civic_issues',
      resource_type: 'image',
      transformation: [
        { width: 1200, height: 1200, crop: 'limit' },
        { quality: 'auto:good', fetch_format: 'auto' }
      ],
      flags: 'progressive',
    },
    (error, result) => {
      const uploadTime = Date.now() - uploadStart;
      
      if (error) {
        console.error('❌ Cloudinary upload failed:', error);
        return res.status(500).json({
          success: false,
          message: 'Image upload failed: ' + error.message
        });
      }

            console.log('✅ Cloudinary upload successful!');
      console.log('📈 Upload statistics:', {
        url: result.secure_url,
        publicId: result.public_id,
        originalSize: `${(req.file.size / 1024 / 1024).toFixed(2)}MB`,
        compressedSize: `${Math.round(result.bytes / 1024)}KB`,
        compressionRatio: `${(((req.file.size - result.bytes) / req.file.size) * 100).toFixed(1)}%`,
        format: result.format,
        uploadTime: `${uploadTime}ms`,
        dimensions: `${result.width}x${result.height}`
      });
      req.body.imageUrl = result.secure_url;
      req.uploadStats = {
        originalSize: req.file.size,
        compressedSize: result.bytes,
        uploadTime: uploadTime
      };

      next();
    }
  );

  streamifier.createReadStream(req.file.buffer).pipe(stream);
};

// @desc    Create a new report with image upload and compression
// @route   POST /api/reports
// @access  Private
exports.createReport = [
  upload.single('photo'),
  uploadToCloudinary,
  async (req, res, next) => {
        try {
      console.log('📝 Creating new report...');
      console.log('📋 Request data:', {
        title: req.body.title,
        category: req.body.category,
        address: req.body.address,
        hasPhoto: !!req.body.imageUrl,
        hasGPS: !!(req.body.latitude && req.body.longitude),
        severity: req.body.severity
      });

      const { title, category, address, description, latitude, longitude, severity } = req.body;
      const reportData = {
        user: req.user.id,
        title: title || category,
        category,
        address,
        description,
        status: 'pending',
        priority: 'medium'
      };

      if (severity) {
        const severityLevel = parseInt(severity);
        reportData.severity = severityLevel;
        if (severityLevel >= 4) reportData.priority = 'high';
        else if (severityLevel <= 2) reportData.priority = 'low';
      }

      if (req.body.imageUrl) {
        reportData.imageUrl = req.body.imageUrl;
      }

      
      if (latitude && longitude) {
        reportData.location = {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        };
      }

      const report = await Report.create(reportData);
      res.status(201).json({
        success: true,
        message: 'Report submitted successfully',
        data: report,
        uploadStats: req.uploadStats || null
      });

    } catch (error) {
      console.error('❌ Report creation failed:', error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
];

// @desc    Get all reports (Admin only)
// @route   GET /api/reports
// @access  Private/Admin
exports.getReports = async (req, res, next) => {
  try {
    const reports = await Report.find()
      .populate('user', 'email phone')
      .sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      count: reports.length,
      data: reports
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};

// @desc    Get reports for logged-in user
// @route   GET /api/reports/my-reports
// @access  Private
exports.getUserReports = async (req, res, next) => {
  try {
    const reports = await Report.find({ user: req.user.id })
      .sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      count: reports.length,
      data: reports
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};

// Add this new function to your existing reportController.js file

// @desc    Upvote or un-upvote a report
// @route   PUT /api/reports/:id/upvote
// @access  Private
exports.upvoteReport = async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    // Check if the user has already upvoted this report
    const upvotedIndex = report.upvotes.findIndex(
      (userId) => userId.toString() === req.user.id
    );

    if (upvotedIndex > -1) {
      // User has already upvoted, so remove the upvote (un-upvote)
      report.upvotes.splice(upvotedIndex, 1);
    } else {
      // User has not upvoted, so add the upvote
      report.upvotes.push(req.user.id);
    }

    await report.save();

    res.status(200).json({ success: true, data: report });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Also, ensure your getReports function populates user details
// Find your existing `getReports` function and make sure it includes `.populate('user', 'email')`
// @route   GET /api/reports/:id
// @access  Public
exports.getReport = async (req, res, next) => {
  try {
    const report = await Report.findById(req.params.id).populate('user', 'email phone');
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }
    res.status(200).json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

const uploadAfterImageToCloudinary = (req, res, next) => {
  if (!req.file) return next();
  const stream = cloudinary.uploader.upload_stream(
    {
      folder: 'civic_issues/after',
      resource_type: 'image',
      transformation: [
        { width: 1200, height: 1200, crop: 'limit' },
        { quality: 'auto:good', fetch_format: 'auto' }
      ],
      flags: 'progressive',
    },
    (error, result) => {
      if (error) return res.status(500).json({ success: false, message: "After image upload failed: " + error.message });
      req.body.afterImageUrl = result.secure_url;
      next();
    }
  );
  streamifier.createReadStream(req.file.buffer).pipe(stream);
};

// @desc    Update report status (Admin only)
// @route   PUT /api/reports/:id
// @access  Private/Admin
exports.updateReportStatus = [
  upload.single('afterImage'),
  uploadAfterImageToCloudinary,
  async (req, res, next) => {
    try {
      let report = await Report.findById(req.params.id);
      if (!report) return res.status(404).json({ success: false, message: 'Report not found' });

      if (req.body.status === 'resolved' && !req.body.afterImageUrl && !report.afterImageUrl) {
        return res.status(400).json({ success: false, message: 'After image required to resolve.' });
      }
      if (req.body.afterImageUrl) {
        report.afterImageUrl = req.body.afterImageUrl;
      }
      if (req.body.status) report.status = req.body.status;
      await report.save();
      report = await Report.findById(report._id).populate('user', 'email phone');
      res.status(200).json({ success: true, data: report });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }
];

// @desc    Replace a user's report image
// @route   PUT /api/reports/:id/image
// @access  Private
exports.updateUserReportImage = [
  upload.single('photo'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No image file uploaded.' });
      }

      const report = await Report.findById(req.params.id);
      if (!report) {
        return res.status(404).json({ success: false, message: 'Report not found' });
      }
      // Authorization checks
      if (report.user.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: 'User not authorized to update this report' });
      }
      if (report.status !== 'pending') {
        return res.status(400).json({ success: false, message: 'Cannot change image for a report that is in progress or resolved' });
      }

      // Delete old image from Cloudinary if it exists
      if (report.imageUrl) {
        await deleteFromCloudinary(report.imageUrl);
      }

      // Upload new image
      const stream = cloudinary.uploader.upload_stream({ folder: 'civic_issues' }, async (error, result) => {
        if (error) {
          return res.status(500).json({ success: false, message: 'Image upload failed' });
        }
        report.imageUrl = result.secure_url;
        await report.save();
        res.status(200).json({ success: true, data: report });
      });
      streamifier.createReadStream(req.file.buffer).pipe(stream);

    } catch (error) {
      res.status(500).json({ success: false, message: 'Server Error: ' + error.message });
    }
  }
];

// @desc    Delete a report image (for Users and Admins)
// @route   DELETE /api/reports/:id/image
// @access  Private
exports.deleteReportImage = async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    // Admin logic
    if (req.user.role === 'admin') {
      const { imageType } = req.body; // 'before' or 'after'
      if (imageType === 'before' && report.imageUrl) {
        await deleteFromCloudinary(report.imageUrl);
        report.imageUrl = null;
      } else if (imageType === 'after' && report.afterImageUrl) {
        await deleteFromCloudinary(report.afterImageUrl);
        report.afterImageUrl = null;
      } else {
        return res.status(400).json({ success: false, message: 'Invalid or missing image type specified.' });
      }
    } 
    // User logic
    else {
      // Authorization checks for user
      if (report.user.toString() !== req.user.id) {
        return res.status(403).json({ success: false, message: 'User not authorized' });
      }
      if (report.status !== 'pending') {
        return res.status(400).json({ success: false, message: 'Cannot delete image for a non-pending report' });
      }
      if (report.imageUrl) {
        await deleteFromCloudinary(report.imageUrl);
        report.imageUrl = null;
      } else {
         return res.status(400).json({ success: false, message: 'No image to delete.' });
      }
    }
    
    await report.save();
    res.status(200).json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error: ' + error.message });
  }
};


// @desc    Delete report (Admin only)
// @route   DELETE /api/reports/:id
// @access  Private/Admin
// @desc    Delete report (Admin or Owner)
// @route   DELETE /api/reports/:id
// @access  Private
exports.deleteReport = async (req, res, next) => {
  try {
    const report = await Report.findById(req.params.id);

    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found' });
    }

    // Check if user is the report owner OR an admin
    if (report.user.toString() !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'User not authorized to delete this report' });
    }

    // Helper function to delete from Cloudinary (if you have one)
    const deleteFromCloudinary = async (imageUrl) => {
        if (!imageUrl) return;
        try {
            const publicIdWithFolder = imageUrl.split('/').slice(-2).join('/').split('.')[0];
            await cloudinary.uploader.destroy(publicIdWithFolder);
        } catch (err) {
            console.error("Failed to delete image from Cloudinary:", err);
        }
    };

    // Delete associated images from Cloudinary
    await deleteFromCloudinary(report.imageUrl);
    await deleteFromCloudinary(report.afterImageUrl);

    await report.deleteOne();
    
    res.status(200).json({
      success: true,
      message: 'Report deleted successfully',
      data: {}
    });
  } catch (error) {
    console.error('Error deleting report:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};

// @desc    Get report statistics (Admin only)
// @route   GET /api/reports/stats
// @access  Private/Admin
exports.getReportStats = async (req, res, next) => {
  try {
    const [total, pending, inProgress, resolved] = await Promise.all([
      Report.countDocuments(),
      Report.countDocuments({ status: 'pending' }),
      Report.countDocuments({ status: 'in-progress' }),
      Report.countDocuments({ status: 'resolved' })
    ]);
    res.status(200).json({ success: true, data: { total, pending, inProgress, resolved } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};
// ... (keep getNearbyReports and bulkUpdateReports as they are)
// @desc    Get reports by location (within radius)
// @route   GET /api/reports/nearby/:latitude/:longitude/:radius
// @access  Public
exports.getNearbyReports = async (req, res, next) => {
  try {
    const { latitude, longitude, radius } = req.params;
    
    console.log('📍 Finding reports near:', {
      lat: parseFloat(latitude),
      lng: parseFloat(longitude),
      radius: `${radius}km`
    });

    const reports = await Report.find({
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
          },
          $maxDistance: parseFloat(radius) * 1000 // Convert km to meters
        }
      },
      status: { $ne: 'resolved' } // Exclude resolved issues
    }).populate('user', 'email');

    console.log('📊 Nearby reports found:', reports.length);
    
    res.status(200).json({
      success: true,
      count: reports.length,
      data: reports
    });
  } catch (error) {
    console.error('❌ Error finding nearby reports:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};

// @desc    Bulk update report statuses (Admin only)
// @route   PUT /api/reports/bulk-update
// @access  Private/Admin
exports.bulkUpdateReports = async (req, res, next) => {
  try {
    const { reportIds, updateData } = req.body;
    
    console.log('🔄 Bulk updating reports:', {
      count: reportIds.length,
      updateData
    });

    const result = await Report.updateMany(
      { _id: { $in: reportIds } },
      updateData,
      { runValidators: true }
    );

    console.log('✅ Bulk update completed:', {
      matched: result.matchedCount,
      modified: result.modifiedCount
    });
    
    res.status(200).json({
      success: true,
      message: `Updated ${result.modifiedCount} reports`,
      data: {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount
      }
    });
  } catch (error) {
    console.error('❌ Error in bulk update:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};  