/**
 * CivicSync Duplicate Report Detector
 * 
 * Detects duplicate/similar reports using a multi-signal weighted scoring model:
 *  - Text similarity (TF-IDF + cosine similarity): 35%
 *  - Location proximity (geospatial distance): 30%
 *  - Category match: 15%
 *  - Image similarity (perceptual hash): 10%
 *  - Time recency: 10%
 */

const Report = require('../models/Report');
const TextSimilarityEngine = require('./textSimilarity');

const textEngine = new TextSimilarityEngine();

// Scoring weights
const WEIGHTS = {
  TEXT_SIMILARITY: 0.35,
  LOCATION_PROXIMITY: 0.30,
  CATEGORY_MATCH: 0.15,
  IMAGE_SIMILARITY: 0.10,
  TIME_RECENCY: 0.10,
};

// Thresholds
const DUPLICATE_THRESHOLD = 0.55;       // Score above this = likely duplicate
const HIGH_CONFIDENCE_THRESHOLD = 0.75;  // Score above this = very likely duplicate
const MAX_DISTANCE_KM = 2;              // Only compare reports within 2km
const MAX_AGE_DAYS = 30;                // Only compare reports from last 30 days
const MAX_CANDIDATES = 50;              // Max reports to compare against

/**
 * Calculate location proximity score (0-1)
 * Closer distance = higher score
 */
function locationProximityScore(coord1, coord2) {
  if (!coord1 || !coord2) return 0;

  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;

  // Haversine formula for distance in km
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  if (distance > MAX_DISTANCE_KM) return 0;

  // Inverse linear score: 0m = 1.0, MAX_DISTANCE = 0.0
  return Math.max(0, 1 - distance / MAX_DISTANCE_KM);
}

/**
 * Calculate time recency score (0-1)
 * More recent reports score higher
 */
function timeRecencyScore(reportDate) {
  const now = new Date();
  const diffMs = now - new Date(reportDate);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays > MAX_AGE_DAYS) return 0;

  // Exponential decay: same-day = 1.0, older = lower
  return Math.exp(-diffDays / 10);
}

/**
 * Compare two image hashes (perceptual hash) using Hamming distance
 * Returns similarity score 0-1
 */
function imageHashSimilarity(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) return 0;

  let matchingBits = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] === hash2[i]) matchingBits++;
  }

  return matchingBits / hash1.length;
}

/**
 * Main duplicate detection function
 * 
 * @param {Object} newReport - The new report to check
 * @param {string} newReport.description - Report description
 * @param {string} newReport.title - Report title
 * @param {string} newReport.category - Report category
 * @param {number[]} newReport.coordinates - [longitude, latitude]
 * @param {string} newReport.imageHash - Perceptual hash of image (optional)
 * @param {string} newReport.address - Report address
 * @returns {Object} - Duplicate analysis result
 */
async function detectDuplicates(newReport) {
  const { description, title, category, coordinates, imageHash, address } = newReport;

  // Step 1: Find candidate reports (nearby + same category + recent)
  const query = {
    status: { $ne: 'resolved' },
    createdAt: { $gte: new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000) }
  };

  // If we have coordinates, use geospatial query to narrow down
  if (coordinates && coordinates.length === 2) {
    query.location = {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: coordinates
        },
        $maxDistance: MAX_DISTANCE_KM * 1000 // meters
      }
    };
  }

  let candidates;
  try {
    candidates = await Report.find(query)
      .limit(MAX_CANDIDATES)
      .select('title description category location address createdAt imageUrl')
      .lean();
  } catch (err) {
    // If geo index doesn't exist, fall back to non-geo query
    delete query.location;
    candidates = await Report.find(query)
      .limit(MAX_CANDIDATES)
      .select('title description category location address createdAt imageUrl')
      .lean();
  }

  if (!candidates || candidates.length === 0) {
    return {
      isDuplicate: false,
      confidence: 0,
      message: 'No similar reports found in the area.',
      duplicates: []
    };
  }

  // Step 2: Compute text similarity scores against all candidates
  const queryText = `${title || ''} ${description || ''} ${address || ''}`;
  const corpusTexts = candidates.map(c =>
    `${c.title || ''} ${c.description || ''} ${c.address || ''}`
  );
  const textScores = textEngine.computeSimilarities(queryText, corpusTexts);

  // Step 3: Score each candidate
  const scoredCandidates = candidates.map((candidate, idx) => {
    const textScore = textScores[idx];

    const categoryScore = candidate.category === category ? 1.0 : 0.0;

    const locationScore = (coordinates && candidate.location?.coordinates)
      ? locationProximityScore(coordinates, candidate.location.coordinates)
      : 0;

    const timeScore = timeRecencyScore(candidate.createdAt);

    // Image hash comparison (if both have hashes)
    const imgScore = (imageHash && candidate.imageHash)
      ? imageHashSimilarity(imageHash, candidate.imageHash)
      : 0;

    // Weighted composite score
    const compositeScore =
      textScore * WEIGHTS.TEXT_SIMILARITY +
      locationScore * WEIGHTS.LOCATION_PROXIMITY +
      categoryScore * WEIGHTS.CATEGORY_MATCH +
      imgScore * WEIGHTS.IMAGE_SIMILARITY +
      timeScore * WEIGHTS.TIME_RECENCY;

    return {
      reportId: candidate._id,
      title: candidate.title,
      description: candidate.description?.substring(0, 100),
      category: candidate.category,
      address: candidate.address,
      createdAt: candidate.createdAt,
      imageUrl: candidate.imageUrl,
      scores: {
        text: parseFloat(textScore.toFixed(3)),
        location: parseFloat(locationScore.toFixed(3)),
        category: categoryScore,
        image: parseFloat(imgScore.toFixed(3)),
        recency: parseFloat(timeScore.toFixed(3)),
        composite: parseFloat(compositeScore.toFixed(3))
      }
    };
  });

  // Step 4: Sort by composite score and filter above threshold
  scoredCandidates.sort((a, b) => b.scores.composite - a.scores.composite);

  const duplicates = scoredCandidates.filter(
    c => c.scores.composite >= DUPLICATE_THRESHOLD
  );

  const topScore = scoredCandidates[0]?.scores.composite || 0;

  let confidence, message;
  if (topScore >= HIGH_CONFIDENCE_THRESHOLD) {
    confidence = 'high';
    message = 'This report is very likely a duplicate of an existing report.';
  } else if (topScore >= DUPLICATE_THRESHOLD) {
    confidence = 'medium';
    message = 'This report may be a duplicate. Please review similar reports.';
  } else {
    confidence = 'low';
    message = 'No strong duplicates found.';
  }

  return {
    isDuplicate: topScore >= DUPLICATE_THRESHOLD,
    confidence,
    topScore: parseFloat(topScore.toFixed(3)),
    message,
    duplicates: duplicates.slice(0, 5), // Top 5 duplicates
    totalCandidatesChecked: candidates.length
  };
}

module.exports = { detectDuplicates, DUPLICATE_THRESHOLD, HIGH_CONFIDENCE_THRESHOLD };
