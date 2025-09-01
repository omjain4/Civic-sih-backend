const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Environment variable validation
if (!process.env.JWT_SECRET && !process.env.ACCESS_TOKEN_SECRET) {
  console.error('JWT_SECRET or ACCESS_TOKEN_SECRET must be defined in environment variables');
  process.exit(1);
}

// Utility to generate token - using existing ACCESS_TOKEN_SECRET as fallback
const getSignedJwtToken = (id) => {
  const secret = process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET;
  const expiry = process.env.ACCESS_TOKEN_EXPIRY || '30d';
  
  return jwt.sign({ id }, secret, {
    expiresIn: expiry
  });
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
  console.log('Register route hit!');
  console.log('Request body:', req.body);
  
  const { email, phone, password } = req.body;

  // Add validation
  if (!email || !phone || !password) {
    console.log('Missing required fields:', { email: !!email, phone: !!phone, password: !!password });
    return res.status(400).json({ 
      success: false, 
      message: 'Please provide email, phone, and password' 
    });
  }

  console.log('✅ Validation passed, checking for existing user...');

  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    console.log('Existing user check result:', !!existingUser);
    
    if (existingUser) {
      console.log('❌ User already exists');
      return res.status(400).json({ 
        success: false, 
        message: 'User already exists with this email' 
      });
    }

    console.log('✅ No existing user, creating new user...');

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    console.log('✅ Password hashed, creating user in database...');
    
    const user = await User.create({
      email,
      phone,
      password: hashedPassword
    });

    console.log('✅ User created successfully:', user._id);

    const token = getSignedJwtToken(user._id);
    console.log('✅ Token generated');
    
    const userResponse = await User.findById(user._id);
    console.log('✅ User response prepared');

    res.status(201).json({ 
      success: true, 
      token,
      user: userResponse
    });

  } catch (error) {
    console.error('❌ Register error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    
    // Handle mongoose validation errors
    if (error.name === 'ValidationError') {
      const message = Object.values(error.errors).map(val => val.message).join(', ');
      console.log('Validation error details:', message);
      return res.status(400).json({ 
        success: false, 
        message 
      });
    }
    
    // Handle duplicate key error
    if (error.code === 11000) {
      console.log('Duplicate key error');
      return res.status(400).json({ 
        success: false, 
        message: 'User already exists with this email' 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Server Error during registration' 
    });
  }
};


// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ 
      success: false, 
      message: 'Please provide an email and password' 
    });
  }

  try {
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid credentials' 
      });
    }
    
    const token = getSignedJwtToken(user._id);
    
    // Get user without password but with all other fields including role
    const userResponse = await User.findById(user._id).select('-password');
    
    console.log('Login successful - User data being returned:', userResponse);
    console.log('User role:', userResponse.role);
    
    res.status(200).json({ 
      success: true, 
      token,
      user: userResponse // This should include the role field
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server Error during login' 
    });
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    console.log('Returning user data:', user); // Debug log
    
    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('GetMe error:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error'
    });
  }
};

