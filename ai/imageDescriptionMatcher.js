/**
 * CivicSync Image-Description Matcher
 * 
 * Verifies that an uploaded image matches the user's text description.
 * Uses a hybrid approach:
 *  1. Google Gemini Vision API to understand image content
 *  2. Custom TF-IDF text similarity to compare AI description with user description
 *  3. Keyword extraction and category validation
 */

const TextSimilarityEngine = require('./textSimilarity');
const { GoogleGenAI } = require('@google/genai');

const textEngine = new TextSimilarityEngine();

// Category-specific keywords that should appear in matching descriptions
const CATEGORY_KEYWORDS = {
  'Roads & Potholes': ['road', 'pothole', 'crack', 'asphalt', 'pavement', 'hole', 'damaged', 'broken', 'street', 'highway'],
  'Water & Utilities': ['water', 'pipe', 'leak', 'tap', 'supply', 'plumbing', 'valve', 'flow', 'wet'],
  'Drainage & Sewage': ['drain', 'sewage', 'sewer', 'clog', 'overflow', 'water', 'gutter', 'blocked', 'flooding'],
  'Street Lighting': ['light', 'lamp', 'pole', 'dark', 'broken', 'streetlight', 'bulb', 'electric', 'night'],
  'Garbage & Waste': ['garbage', 'trash', 'waste', 'dump', 'litter', 'pile', 'bin', 'debris', 'rubbish', 'dirty'],
  'Parks & Public Spaces': ['park', 'tree', 'bench', 'green', 'garden', 'playground', 'grass', 'plant', 'public'],
  'Traffic & Signals': ['traffic', 'signal', 'sign', 'road', 'intersection', 'congestion', 'vehicle', 'car'],
  'Noise Pollution': ['noise', 'loud', 'sound', 'disturbance', 'construction', 'music', 'speaker'],
  'Encroachment': ['encroachment', 'illegal', 'blocked', 'unauthorized', 'vendor', 'footpath', 'building'],
  'Building & Infrastructure': ['building', 'wall', 'structure', 'crack', 'damage', 'collapse', 'construction', 'bridge'],
  'Electricity': ['electric', 'wire', 'cable', 'power', 'transformer', 'pole', 'outage', 'spark'],
  'Public Safety': ['danger', 'unsafe', 'accident', 'hazard', 'risk', 'broken', 'sharp', 'exposure'],
  'Mosquito & Pest Control': ['mosquito', 'pest', 'insect', 'stagnant', 'water', 'breeding', 'larvae'],
  'Other': []
};

/**
 * Get AI-generated description of an image using Gemini Vision API
 * This runs on the backend using the server's API key
 */
async function getAIImageDescription(imageBuffer, apiKey) {
  if (!apiKey) {
    return { success: false, description: null, error: 'Gemini API key not configured' };
  }

  try {
    const base64Image = imageBuffer.toString('base64');
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Analyze this image and describe what you see in detail. Focus on:
1. The main subject/problem visible in the image
2. The physical environment and setting
3. Any damage, hazards, or issues visible
4. Infrastructure elements (roads, buildings, utilities, etc.)
5. Environmental conditions

Provide a factual, objective description in 3-5 sentences. Do not include opinions or assumptions about who took the photo.`
            },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Image
              }
            }
          ]
        }
      ]
    });

    const text = response.text;

    if (!text) {
      return { success: false, description: null, error: 'No description generated' };
    }

    return { success: true, description: text };
  } catch (error) {
    console.error('Gemini API error:', error.message);
    return { success: false, description: null, error: error.message };
  }
}

/**
 * Compare user description with AI-generated image description
 * Returns a detailed match analysis
 */
function compareDescriptions(userDescription, aiDescription) {
  if (!userDescription || !aiDescription) {
    return {
      canCompare: false,
      similarity: 0,
      message: 'Missing description for comparison.'
    };
  }

  // TF-IDF cosine similarity
  const tfidfScore = textEngine.computeSimilarities(
    userDescription,
    [aiDescription]
  )[0];

  // Jaccard similarity as secondary metric
  const jaccardScore = textEngine.jaccardSimilarity(userDescription, aiDescription);

  // Combined score (weighted average)
  const combinedScore = tfidfScore * 0.6 + jaccardScore * 0.4;

  // Extract key terms from both
  const userKeyTerms = textEngine.extractKeyTerms(userDescription, 8);
  const aiKeyTerms = textEngine.extractKeyTerms(aiDescription, 8);

  // Find overlapping key terms
  const userTermSet = new Set(userKeyTerms.map(t => t.term));
  const aiTermSet = new Set(aiKeyTerms.map(t => t.term));
  const overlapping = [...userTermSet].filter(t => aiTermSet.has(t));

  let matchLevel, message;
  if (combinedScore >= 0.5) {
    matchLevel = 'high';
    message = 'Image content strongly matches the provided description.';
  } else if (combinedScore >= 0.25) {
    matchLevel = 'medium';
    message = 'Image content partially matches the description. Some details may differ.';
  } else {
    matchLevel = 'low';
    message = 'Image content does not closely match the description. Please verify the image.';
  }

  return {
    canCompare: true,
    similarity: parseFloat(combinedScore.toFixed(3)),
    tfidfScore: parseFloat(tfidfScore.toFixed(3)),
    jaccardScore: parseFloat(jaccardScore.toFixed(3)),
    matchLevel,
    message,
    userKeyTerms: userKeyTerms.map(t => t.term),
    aiKeyTerms: aiKeyTerms.map(t => t.term),
    overlappingTerms: overlapping
  };
}

/**
 * Validate that image matches the selected category
 */
function validateCategory(aiDescription, category) {
  const keywords = CATEGORY_KEYWORDS[category];
  if (!keywords || keywords.length === 0 || !aiDescription) {
    return { canValidate: false, matches: false, message: 'Category validation not available.' };
  }

  const descTokens = new Set(textEngine.tokenize(aiDescription));
  const matchedKeywords = keywords.filter(kw => descTokens.has(kw));

  const matchRatio = matchedKeywords.length / Math.min(keywords.length, 5);

  return {
    canValidate: true,
    matches: matchRatio >= 0.2,
    matchedKeywords,
    confidence: parseFloat(matchRatio.toFixed(3)),
    message: matchRatio >= 0.2
      ? `Image appears to match the "${category}" category.`
      : `Image may not match the selected "${category}" category.`
  };
}

/**
 * Full image-description matching pipeline
 * 
 * @param {Buffer} imageBuffer - Raw image buffer
 * @param {string} userDescription - User's text description
 * @param {string} category - Selected report category
 * @param {string} geminiApiKey - Google Gemini API key
 * @returns {Object} Complete match analysis
 */
async function matchImageWithDescription(imageBuffer, userDescription, category, geminiApiKey) {
  const result = {
    aiDescription: null,
    descriptionMatch: null,
    categoryValidation: null,
    overallMatch: 'unknown'
  };

  // Step 1: Get AI description of the image
  const aiResult = await getAIImageDescription(imageBuffer, geminiApiKey);

  if (aiResult.success) {
    result.aiDescription = aiResult.description;

    // Step 2: Compare with user description
    result.descriptionMatch = compareDescriptions(userDescription, aiResult.description);

    // Step 3: Validate against category
    result.categoryValidation = validateCategory(aiResult.description, category);

    // Overall assessment
    const descScore = result.descriptionMatch.similarity || 0;
    const catValid = result.categoryValidation.matches;

    if (descScore >= 0.4 && catValid) {
      result.overallMatch = 'high';
    } else if (descScore >= 0.2 || catValid) {
      result.overallMatch = 'medium';
    } else {
      result.overallMatch = 'low';
    }
  } else {
    result.aiDescription = null;
    result.descriptionMatch = {
      canCompare: false,
      message: `AI analysis unavailable: ${aiResult.error}`
    };
    result.categoryValidation = { canValidate: false, message: 'AI analysis unavailable.' };
  }

  return result;
}

module.exports = {
  matchImageWithDescription,
  getAIImageDescription,
  compareDescriptions,
  validateCategory
};
