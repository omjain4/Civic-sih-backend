/**
 * CivicSync AI Controller
 * 
 * API endpoints for the AI analysis system:
 *  - Duplicate detection
 *  - Image metadata analysis
 *  - Image-description matching
 *  - Full AI analysis pipeline
 */

const multer = require('multer');
const { detectDuplicates } = require('../ai/duplicateDetector');
const { analyzeImage, computePerceptualHash } = require('../ai/imageAnalyzer');
const { matchImageWithDescription } = require('../ai/imageDescriptionMatcher');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  }
});

/**
 * @desc    Check for duplicate reports
 * @route   POST /api/ai/check-duplicate
 * @access  Private
 */
exports.checkDuplicate = async (req, res) => {
  try {
    const { description, title, category, latitude, longitude, address } = req.body;

    if (!description && !title) {
      return res.status(400).json({
        success: false,
        message: 'Description or title is required for duplicate detection.'
      });
    }

    const coordinates = (latitude && longitude)
      ? [parseFloat(longitude), parseFloat(latitude)]
      : null;

    const result = await detectDuplicates({
      description,
      title: title || category,
      category,
      coordinates,
      address
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('❌ Duplicate detection error:', error);
    res.status(500).json({ success: false, message: 'Duplicate detection failed: ' + error.message });
  }
};

/**
 * @desc    Analyze image metadata (EXIF, GPS, perceptual hash)
 * @route   POST /api/ai/analyze-image
 * @access  Private
 */
exports.analyzeImageMetadata = [
  upload.single('photo'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Image file is required.'
        });
      }

      const { latitude, longitude } = req.body;
      const coordinates = (latitude && longitude)
        ? [parseFloat(longitude), parseFloat(latitude)]
        : null;

      const analysis = await analyzeImage(req.file.buffer, coordinates);

      res.status(200).json({
        success: true,
        data: {
          metadata: analysis.metadata,
          locationVerification: analysis.locationVerification,
          timestampAssessment: analysis.timestampAssessment,
          imageQuality: analysis.imageStats,
          overallTrust: analysis.overallTrust,
          perceptualHash: analysis.perceptualHash ? `${analysis.perceptualHash.length}-bit hash computed` : null
        }
      });
    } catch (error) {
      console.error('❌ Image analysis error:', error);
      res.status(500).json({ success: false, message: 'Image analysis failed: ' + error.message });
    }
  }
];

/**
 * @desc    Match image with description
 * @route   POST /api/ai/match-description
 * @access  Private
 */
exports.matchDescription = [
  upload.single('photo'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Image file is required.'
        });
      }

      const { description, category } = req.body;
      if (!description) {
        return res.status(400).json({
          success: false,
          message: 'Description is required for matching.'
        });
      }

      const geminiApiKey = process.env.GOOGLE_AI_API_KEY;
      const result = await matchImageWithDescription(
        req.file.buffer,
        description,
        category || 'Other',
        geminiApiKey
      );

      res.status(200).json({ success: true, data: result });
    } catch (error) {
      console.error('❌ Description matching error:', error);
      res.status(500).json({ success: false, message: 'Description matching failed: ' + error.message });
    }
  }
];

/**
 * @desc    Full AI analysis pipeline (duplicate + metadata + description match)
 * @route   POST /api/ai/full-analysis
 * @access  Private
 */
exports.fullAnalysis = [
  upload.single('photo'),
  async (req, res) => {
    try {
      const { description, title, category, latitude, longitude, address } = req.body;

      const coordinates = (latitude && longitude)
        ? [parseFloat(longitude), parseFloat(latitude)]
        : null;

      // Run all analyses in parallel
      const analyses = await Promise.allSettled([
        // 1. Duplicate detection
        detectDuplicates({
          description,
          title: title || category,
          category,
          coordinates,
          address
        }),

        // 2. Image metadata analysis (if image provided)
        req.file
          ? analyzeImage(req.file.buffer, coordinates)
          : Promise.resolve(null),

        // 3. Image-description matching (if image + description provided)
        (req.file && description)
          ? matchImageWithDescription(
              req.file.buffer,
              description,
              category || 'Other',
              process.env.GOOGLE_AI_API_KEY
            )
          : Promise.resolve(null)
      ]);

      const duplicateResult = analyses[0].status === 'fulfilled' ? analyses[0].value : null;
      const imageAnalysis = analyses[1].status === 'fulfilled' ? analyses[1].value : null;
      const descriptionMatch = analyses[2].status === 'fulfilled' ? analyses[2].value : null;

      // Compute overall credibility score
      let credibilityScore = 0.5; // Default neutral
      let factors = [];

      if (duplicateResult) {
        if (duplicateResult.isDuplicate) {
          credibilityScore -= 0.2;
          factors.push('Potential duplicate detected');
        } else {
          credibilityScore += 0.1;
          factors.push('No duplicates found');
        }
      }

      if (imageAnalysis) {
        if (imageAnalysis.overallTrust === 'high') {
          credibilityScore += 0.2;
          factors.push('Image metadata verified');
        } else if (imageAnalysis.overallTrust === 'low') {
          credibilityScore -= 0.15;
          factors.push('Image metadata concerns');
        }
      }

      if (descriptionMatch) {
        if (descriptionMatch.overallMatch === 'high') {
          credibilityScore += 0.2;
          factors.push('Image matches description');
        } else if (descriptionMatch.overallMatch === 'low') {
          credibilityScore -= 0.15;
          factors.push('Image-description mismatch');
        }
      }

      credibilityScore = Math.max(0, Math.min(1, credibilityScore));

      res.status(200).json({
        success: true,
        data: {
          duplicateDetection: duplicateResult,
          imageAnalysis: imageAnalysis ? {
            metadata: imageAnalysis.metadata,
            locationVerification: imageAnalysis.locationVerification,
            timestampAssessment: imageAnalysis.timestampAssessment,
            imageQuality: imageAnalysis.imageStats,
            overallTrust: imageAnalysis.overallTrust
          } : null,
          descriptionMatch,
          credibility: {
            score: parseFloat(credibilityScore.toFixed(3)),
            level: credibilityScore >= 0.7 ? 'high' : credibilityScore >= 0.4 ? 'medium' : 'low',
            factors
          }
        }
      });
    } catch (error) {
      console.error('❌ Full analysis error:', error);
      res.status(500).json({ success: false, message: 'AI analysis failed: ' + error.message });
    }
  }
];
