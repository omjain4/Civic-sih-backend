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
  upvotes: [{ type: mongoose.Schema.ObjectId, ref: 'User' }]
});

module.exports = mongoose.model('Report', ReportSchema);