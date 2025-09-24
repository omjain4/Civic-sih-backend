const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const streamifier = require('streamifier');

// --- Cloudinary and Multer Setup ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

const uploadToCloudinary = (req, res, next) => {
  if (!req.file) return next();

  const stream = cloudinary.uploader.upload_stream(
    { folder: 'profile_photos', transformation: [{ width: 200, height: 200, crop: 'fill', gravity: 'face' }] },
    (error, result) => {
      if (error) {
        console.error('Cloudinary Upload Error:', error);
        return next(error);
      }
      req.body.profilePhoto = result.secure_url;
      next();
    }
  );
  streamifier.createReadStream(req.file.buffer).pipe(stream);
};
// --- End Setup ---

const getSignedJwtToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d'
  });
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
exports.register = [
  upload.single('profilePhoto'),
  uploadToCloudinary,
  async (req, res) => {
    const { username, email, phone, password, profilePhoto } = req.body;

    if (!username || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: 'Please provide all required fields' });
    }

    try {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      
      const user = await User.create({
        username,
        email,
        phone,
        password: hashedPassword,
        profilePhoto // This will be the Cloudinary URL or undefined (to use default)
      });

      const token = getSignedJwtToken(user._id);
      const userResponse = await User.findById(user._id);

      res.status(201).json({ success: true, token, user: userResponse });
    } catch (error) {
      console.error('Registration Error:', error);
      let message = 'Server Error during registration';
      if (error.code === 11000) {
        message = `User with that ${Object.keys(error.keyValue)[0]} already exists`;
      } else if (error.name === 'ValidationError') {
        message = Object.values(error.errors).map(val => val.message).join(', ');
      }
      res.status(400).json({ success: false, message });
    }
  }
];


// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Please provide an email and password' });
  }

  try {
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const token = getSignedJwtToken(user._id);
    const userResponse = await User.findById(user._id);
    
    res.status(200).json({ success: true, token, user: userResponse });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error during login' });
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};