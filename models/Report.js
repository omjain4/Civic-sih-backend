const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  category: {
    type: String,
    required: [true, 'Please select a category'],
    enum: [
      "Roads & Potholes",
      "Water & Utilities",
      "Sanitation & Waste",
      "Streetlights & Power",
      "Pan Masala Spitting & Stains",
      "Littering & Garbage Dumping",
      "Illegal Parking",
      "Noise Pollution",
      "Parks & Public Spaces",
      "Public Safety",
      "Drainage & Sewerage",
      "Illegal Construction",
      "Encroachment on Footpaths",
      "Other"
    ]
  },
  title: String,
  description: {
    type: String,
    required: [true, 'Please add a description'],
    maxlength: [500, 'Description can not be more than 500 characters']
  },
  imageUrl: {
    type: String // Cloudinary URL (before image)
  },
  afterImageUrl: { // NEW FIELD
    type: String // Cloudinary URL (after image upload by admin)
  },
  // GeoJSON location for GPS coordinates
  location: {
    type: {
      type: String,
      enum: ['Point'],
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    }
  },
  address: {
    type: String,
    required: [true, 'Please add an address or location description']
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'in-progress', 'resolved'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  assignedTo: {
    type: String,
    default: 'Unassigned'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  severity: Number
});

module.exports = mongoose.model('Report', ReportSchema);
