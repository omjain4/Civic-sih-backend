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
  description: {
    type: String,
    required: [true, 'Please add a description'],
    maxlength: [500, 'Description can not be more than 500 characters']
  },
  // GeoJSON location for GPS coordinates
  location: {
    type: {
      type: String,
      enum: ['Point'],
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere' // Create a geospatial index
    }
  },
  address: {
    type: String,
    required: [true, 'Please add an address or location description']
  },
  imageUrl: {
    type: String // Cloudinary URL
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
  }
});

module.exports = mongoose.model('Report', ReportSchema);
