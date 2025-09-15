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
      console.log(`✅ File type accepted: ${file.mimetype}`);
      cb(null, true);
    } else {
      console.log(`❌ File type rejected: ${file.mimetype}`);
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
      // Image compression and optimization transformations
      transformation: [
        {
          width: 1200,
          height: 1200,
          crop: 'limit' // Don't upscale, only downscale if necessary
        },
        {
          quality: 'auto:good', // Automatic quality optimization
          fetch_format: 'auto' // Automatic format selection (WebP, AVIF, etc.)
        }
      ],
      // Additional optimization options
      flags: 'progressive', // Progressive JPEG for faster loading
    },
    (error, result) => {
      const uploadTime = Date.now() - uploadStart;
      
      if (error) {
        console.error('❌ Cloudinary upload failed:', error);
        console.error('Error details:', {
          message: error.message,
          http_code: error.http_code
        });
        return res.status(500).json({
          success: false,
          message: 'Image upload failed: ' + error.message
        });
      }

      // Log successful upload details
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

      // Attach the secure URL to request body for the next middleware
      req.body.imageUrl = result.secure_url;
      req.uploadStats = {
        originalSize: req.file.size,
        compressedSize: result.bytes,
        compressionRatio: ((req.file.size - result.bytes) / req.file.size) * 100,
        uploadTime: uploadTime
      };

      next();
    }
  );

  // Stream the file buffer to Cloudinary
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
      
      // Build report data object
      const reportData = {
        user: req.user.id,
        title: title || category,
        category,
        address,
        description,
        status: 'pending',
        priority: 'medium'
      };

      // Add severity level if provided
      if (severity) {
        const severityLevel = parseInt(severity);
        reportData.severity = severityLevel;
        
        // Set priority based on severity
        if (severityLevel >= 4) reportData.priority = 'high';
        else if (severityLevel <= 2) reportData.priority = 'low';
        
        console.log('📊 Severity level set:', severityLevel);
      }

      // Add compressed image URL if uploaded
      if (req.body.imageUrl) {
        reportData.imageUrl = req.body.imageUrl;
        console.log('🖼️ Photo attached and compressed successfully');
        
        // Log compression statistics if available
        if (req.uploadStats) {
          console.log('📦 Compression stats:', {
            sizeSaved: `${((req.uploadStats.originalSize - req.uploadStats.compressedSize) / 1024 / 1024).toFixed(2)}MB`,
            compressionRatio: `${req.uploadStats.compressionRatio.toFixed(1)}%`
          });
        }
      }

      // Add GPS coordinates if provided (GeoJSON format)
      if (latitude && longitude) {
        reportData.location = {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        };
        console.log('📍 GPS coordinates saved:', {
          lat: parseFloat(latitude),
          lng: parseFloat(longitude)
        });
      }

      // Create the report in database
      const report = await Report.create(reportData);
      console.log('✅ Report created successfully!');
      console.log('🆔 Report ID:', report._id);

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
    console.log('👑 Admin fetching all reports...');
    
    const reports = await Report.find()
      .populate('user', 'email phone')
      .sort({ createdAt: -1 });
    
    console.log('📊 Total reports found:', reports.length);
    
    res.status(200).json({
      success: true,
      count: reports.length,
      data: reports
    });
  } catch (error) {
    console.error('❌ Error fetching reports:', error);
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
    console.log('👤 Fetching reports for user:', req.user.id);
    
    const reports = await Report.find({ user: req.user.id })
      .sort({ createdAt: -1 });
    
    console.log('📊 User reports found:', reports.length);
    
    res.status(200).json({
      success: true,
      count: reports.length,
      data: reports
    });
  } catch (error) {
    console.error('❌ Error fetching user reports:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};

// @desc    Get single report
// @route   GET /api/reports/:id
// @access  Private
exports.getReport = async (req, res, next) => {
  try {
    console.log('🔍 Fetching report:', req.params.id);
    
    const report = await Report.findById(req.params.id)
      .populate('user', 'email phone');
    
    if (!report) {
      console.log('❌ Report not found');
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    console.log('✅ Report found:', report.title || report.category);
    
    res.status(200).json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('❌ Error fetching report:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};

// @desc    Update report status (Admin only)
// @route   PUT /api/reports/:id
// @access  Private/Admin
exports.updateReportStatus = async (req, res, next) => {
  try {
    console.log('📝 Updating report status:', req.params.id);
    console.log('📋 Update data:', req.body);
    
    let report = await Report.findById(req.params.id);
    
    if (!report) {
      console.log('❌ Report not found for update');
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    // Update the report
    report = await Report.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    }).populate('user', 'email phone');

    console.log('✅ Report updated successfully');
    console.log('📊 New status:', report.status);
    
    res.status(200).json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('❌ Error updating report:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete report (Admin only)
// @route   DELETE /api/reports/:id
// @access  Private/Admin
exports.deleteReport = async (req, res, next) => {
  try {
    console.log('🗑️ Deleting report:', req.params.id);
    
    const report = await Report.findById(req.params.id);
    
    if (!report) {
      console.log('❌ Report not found for deletion');
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    // Delete associated image from Cloudinary if exists
    if (report.imageUrl) {
      try {
        // Extract public_id from Cloudinary URL
        const urlParts = report.imageUrl.split('/');
        const publicIdWithExtension = urlParts[urlParts.length - 1];
        const publicId = 'civic_issues/' + publicIdWithExtension.split('.')[0];
        
        const result = await cloudinary.uploader.destroy(publicId);
        console.log('🖼️ Image deleted from Cloudinary:', result);
      } catch (cloudinaryError) {
        console.error('⚠️ Failed to delete image from Cloudinary:', cloudinaryError);
        // Continue with report deletion even if image deletion fails
      }
    }

    await report.deleteOne();
    console.log('✅ Report deleted successfully');
    
    res.status(200).json({
      success: true,
      message: 'Report deleted successfully',
      data: {}
    });
  } catch (error) {
    console.error('❌ Error deleting report:', error);
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
    console.log('📊 Generating report statistics...');
    
    const [total, pending, inProgress, resolved] = await Promise.all([
      Report.countDocuments(),
      Report.countDocuments({ status: 'pending' }),
      Report.countDocuments({ status: 'in-progress' }),
      Report.countDocuments({ status: 'resolved' })
    ]);

    const stats = {
      total,
      pending,
      inProgress,
      resolved
    };

    console.log('📈 Statistics generated:', stats);
    
    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('❌ Error generating statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};

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
