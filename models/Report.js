const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
  // ... all other fields remain the same (user, category, etc.)
  user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
  category: { type: String, required: true },
  title: String,
  description: { type: String, required: true, maxlength: 500 },
  imageUrl: String,
  afterImageUrl: String,
  location: { type: { type: String, enum: ['Point'] }, coordinates: { type: [Number], index: '2dsphere' } },
  address: { type: String, required: true },
  status: { type: String, required: true, enum: ['pending', 'in-progress', 'resolved'], default: 'pending' },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },

  // --- NEW FIELD ---
  assignedDepartment: {
    type: String,
    default: 'Unassigned'
  },

  createdAt: { type: Date, default: Date.now },
  severity: Number,
  imageHash: String, // Perceptual hash for AI duplicate image detection

  // AI verification flags
  aiFlags: {
    isFlagged: { type: Boolean, default: false },
    flagReasons: [String],
    descriptionMatchScore: Number,    // 0-1 similarity between image and description
    descriptionMatchLevel: String,    // 'high', 'medium', 'low'
    categoryMatch: { type: Boolean, default: true },
    locationVerified: { type: Boolean, default: false },
    locationDistance: Number,           // km distance between image GPS and reported location
    imageTrust: String,               // 'high', 'medium', 'low', 'unknown'
    isDuplicate: { type: Boolean, default: false },
    duplicateOf: { type: mongoose.Schema.ObjectId, ref: 'Report' },
    credibilityScore: Number          // 0-1 overall credibility
  },

  comments: [{
    user: { type: mongoose.Schema.ObjectId, ref: 'User' },
    text: { type: String, required: true, maxlength: 500 },
    createdAt: { type: Date, default: Date.now }
  }],
  upvotes: [{ type: mongoose.Schema.ObjectId, ref: 'User' }]
});

module.exports = mongoose.model('Report', ReportSchema);