/**
 * CivicSync Image Analyzer
 * 
 * Analyzes uploaded images for:
 *  1. EXIF metadata extraction (GPS, timestamp, device info)
 *  2. GPS-to-address cross-referencing (detect location mismatches)
 *  3. Perceptual hashing for duplicate image detection
 *  4. Image quality/validity assessment
 */

const sharp = require('sharp');
const exifr = require('exifr');

/**
 * Extract EXIF metadata from an image buffer
 */
async function extractMetadata(imageBuffer) {
  try {
    const exifData = await exifr.parse(imageBuffer, {
      gps: true,
      tiff: true,
      exif: true,
      ifd0: true,
      pick: [
        'GPSLatitude', 'GPSLongitude', 'GPSAltitude',
        'DateTimeOriginal', 'CreateDate', 'ModifyDate',
        'Make', 'Model', 'Software',
        'ImageWidth', 'ImageHeight', 'Orientation',
        'ExposureTime', 'FNumber', 'ISO'
      ]
    });

    if (!exifData) {
      return {
        hasMetadata: false,
        gps: null,
        timestamp: null,
        device: null,
        imageInfo: null
      };
    }

    // Extract GPS coordinates
    const gps = (exifData.GPSLatitude != null && exifData.GPSLongitude != null)
      ? {
          latitude: exifData.latitude || exifData.GPSLatitude,
          longitude: exifData.longitude || exifData.GPSLongitude,
          altitude: exifData.GPSAltitude || null
        }
      : null;

    // Extract timestamp
    const timestamp = exifData.DateTimeOriginal || exifData.CreateDate || exifData.ModifyDate || null;

    // Extract device info
    const device = (exifData.Make || exifData.Model)
      ? {
          make: exifData.Make || 'Unknown',
          model: exifData.Model || 'Unknown',
          software: exifData.Software || null
        }
      : null;

    // Image technical info
    const imageInfo = {
      width: exifData.ImageWidth || null,
      height: exifData.ImageHeight || null,
      orientation: exifData.Orientation || null
    };

    return {
      hasMetadata: true,
      gps,
      timestamp,
      device,
      imageInfo
    };
  } catch (error) {
    console.error('EXIF extraction error:', error.message);
    return {
      hasMetadata: false,
      gps: null,
      timestamp: null,
      device: null,
      imageInfo: null,
      error: error.message
    };
  }
}

/**
 * Compute perceptual hash (aHash) of an image
 * Used for near-duplicate image detection
 * 
 * Algorithm:
 *  1. Resize to 16x16 grayscale
 *  2. Compute average pixel value
 *  3. Each bit = 1 if pixel > average, 0 otherwise
 *  4. Returns 256-bit binary string hash
 */
async function computePerceptualHash(imageBuffer) {
  try {
    const HASH_SIZE = 16;

    // Resize to small grayscale image
    const { data } = await sharp(imageBuffer)
      .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Compute average pixel value
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }
    const average = sum / data.length;

    // Generate binary hash
    let hash = '';
    for (let i = 0; i < data.length; i++) {
      hash += data[i] >= average ? '1' : '0';
    }

    return hash;
  } catch (error) {
    console.error('Perceptual hash error:', error.message);
    return null;
  }
}

/**
 * Compute color histogram of an image (RGB channels, 16 bins each)
 * Returns a normalized histogram object
 */
async function computeColorHistogram(imageBuffer) {
  try {
    const BINS = 16;
    const BIN_SIZE = 256 / BINS;

    // Get raw RGB pixel data at reduced resolution
    const { data } = await sharp(imageBuffer)
      .resize(64, 64, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const histR = new Array(BINS).fill(0);
    const histG = new Array(BINS).fill(0);
    const histB = new Array(BINS).fill(0);

    const totalPixels = data.length / 3;
    for (let i = 0; i < data.length; i += 3) {
      histR[Math.min(Math.floor(data[i] / BIN_SIZE), BINS - 1)]++;
      histG[Math.min(Math.floor(data[i + 1] / BIN_SIZE), BINS - 1)]++;
      histB[Math.min(Math.floor(data[i + 2] / BIN_SIZE), BINS - 1)]++;
    }

    // Normalize
    const normalize = (hist) => hist.map(v => v / totalPixels);

    return {
      red: normalize(histR),
      green: normalize(histG),
      blue: normalize(histB)
    };
  } catch (error) {
    console.error('Color histogram error:', error.message);
    return null;
  }
}

/**
 * Compare two perceptual hashes using Hamming distance
 * Returns similarity score 0-1 (1 = identical)
 */
function compareHashes(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) return 0;

  let matching = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] === hash2[i]) matching++;
  }
  return matching / hash1.length;
}

/**
 * Compare two color histograms using histogram intersection
 * Returns similarity score 0-1
 */
function compareHistograms(hist1, hist2) {
  if (!hist1 || !hist2) return 0;

  let intersection = 0;
  let total = 0;

  ['red', 'green', 'blue'].forEach(channel => {
    for (let i = 0; i < hist1[channel].length; i++) {
      intersection += Math.min(hist1[channel][i], hist2[channel][i]);
      total += hist1[channel][i];
    }
  });

  return total > 0 ? intersection / total : 0;
}

/**
 * Calculate distance between two GPS coordinates in km (Haversine)
 */
function gpsDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Cross-reference image GPS metadata with user-reported location
 * Returns trust assessment
 */
function crossReferenceLocation(imageGPS, reportedCoordinates) {
  if (!imageGPS || !reportedCoordinates) {
    return {
      canVerify: false,
      message: 'GPS data not available in image metadata for verification.'
    };
  }

  const distance = gpsDistance(
    imageGPS.latitude,
    imageGPS.longitude,
    reportedCoordinates[1], // latitude
    reportedCoordinates[0]  // longitude
  );

  if (distance < 0.5) {
    return {
      canVerify: true,
      match: true,
      distance: parseFloat(distance.toFixed(3)),
      message: 'Image GPS matches reported location.',
      trustLevel: 'high'
    };
  } else if (distance < 2) {
    return {
      canVerify: true,
      match: true,
      distance: parseFloat(distance.toFixed(3)),
      message: 'Image GPS is near reported location (within 2km).',
      trustLevel: 'medium'
    };
  } else {
    return {
      canVerify: true,
      match: false,
      distance: parseFloat(distance.toFixed(3)),
      message: `Image GPS is ${distance.toFixed(1)}km from reported location. Possible mismatch.`,
      trustLevel: 'low'
    };
  }
}

/**
 * Check if the image timestamp is recent
 */
function assessTimestamp(timestamp) {
  if (!timestamp) {
    return { hasTimestamp: false, message: 'No timestamp in image metadata.' };
  }

  const imageDate = new Date(timestamp);
  const now = new Date();
  const diffHours = (now - imageDate) / (1000 * 60 * 60);
  const diffDays = diffHours / 24;

  if (diffHours < 24) {
    return {
      hasTimestamp: true,
      isRecent: true,
      age: `${Math.round(diffHours)} hours`,
      message: 'Image was taken recently.',
      trustLevel: 'high'
    };
  } else if (diffDays < 7) {
    return {
      hasTimestamp: true,
      isRecent: true,
      age: `${Math.round(diffDays)} days`,
      message: 'Image was taken within the last week.',
      trustLevel: 'medium'
    };
  } else {
    return {
      hasTimestamp: true,
      isRecent: false,
      age: `${Math.round(diffDays)} days`,
      message: `Image is ${Math.round(diffDays)} days old. May not reflect current conditions.`,
      trustLevel: 'low'
    };
  }
}

/**
 * Full image analysis pipeline
 * 
 * @param {Buffer} imageBuffer - Raw image buffer
 * @param {number[]} reportedCoordinates - [longitude, latitude] from report
 * @returns {Object} Complete analysis result
 */
async function analyzeImage(imageBuffer, reportedCoordinates = null) {
  const results = {
    metadata: null,
    locationVerification: null,
    timestampAssessment: null,
    perceptualHash: null,
    colorHistogram: null,
    imageStats: null,
    overallTrust: 'unknown'
  };

  // Run all analyses in parallel
  const [metadata, pHash, histogram, sharpStats] = await Promise.all([
    extractMetadata(imageBuffer),
    computePerceptualHash(imageBuffer),
    computeColorHistogram(imageBuffer),
    sharp(imageBuffer).stats().catch(() => null)
  ]);

  results.metadata = metadata;
  results.perceptualHash = pHash;
  results.colorHistogram = histogram;

  if (sharpStats) {
    results.imageStats = {
      channels: sharpStats.channels.map(ch => ({
        mean: parseFloat(ch.mean.toFixed(2)),
        std: parseFloat(ch.stdev.toFixed(2)),
        min: ch.min,
        max: ch.max
      })),
      isBlank: sharpStats.channels.every(ch => ch.stdev < 5),
      isDark: sharpStats.channels.every(ch => ch.mean < 30),
      isOverexposed: sharpStats.channels.every(ch => ch.mean > 240)
    };
  }

  // Location cross-referencing
  if (metadata.gps && reportedCoordinates) {
    results.locationVerification = crossReferenceLocation(metadata.gps, reportedCoordinates);
  } else {
    results.locationVerification = {
      canVerify: false,
      message: metadata.gps ? 'No reported coordinates to compare against.' : 'No GPS data in image.'
    };
  }

  // Timestamp assessment
  results.timestampAssessment = assessTimestamp(metadata.timestamp);

  // Compute overall trust score
  let trustPoints = 0;
  let maxPoints = 0;

  if (results.locationVerification.canVerify) {
    maxPoints += 3;
    if (results.locationVerification.trustLevel === 'high') trustPoints += 3;
    else if (results.locationVerification.trustLevel === 'medium') trustPoints += 2;
    else trustPoints += 0;
  }

  if (results.timestampAssessment.hasTimestamp) {
    maxPoints += 2;
    if (results.timestampAssessment.trustLevel === 'high') trustPoints += 2;
    else if (results.timestampAssessment.trustLevel === 'medium') trustPoints += 1;
  }

  if (results.imageStats) {
    maxPoints += 1;
    if (!results.imageStats.isBlank && !results.imageStats.isDark && !results.imageStats.isOverexposed) {
      trustPoints += 1;
    }
  }

  if (maxPoints > 0) {
    const trustRatio = trustPoints / maxPoints;
    results.overallTrust = trustRatio >= 0.7 ? 'high' : trustRatio >= 0.4 ? 'medium' : 'low';
  }

  return results;
}

module.exports = {
  analyzeImage,
  extractMetadata,
  computePerceptualHash,
  computeColorHistogram,
  compareHashes,
  compareHistograms,
  crossReferenceLocation,
  gpsDistance
};
