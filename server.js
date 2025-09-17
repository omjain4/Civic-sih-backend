const bcrypt = require('bcryptjs');
const User = require('./models/User');

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db'); // Adjust path to your DB config

const app = express();

// Connect to database
connectDB();

// Admin seed function
const seedAdminUser = async () => {
  try {
    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: 'om@gmail.com' });
    if (existingAdmin) {
      console.log('✅ Admin user already exists with role:', existingAdmin.role);
      // If admin exists but doesn't have admin role, update it
      if (existingAdmin.role !== 'admin') {
        existingAdmin.role = 'admin';
        await existingAdmin.save();
        console.log('🔄 Updated existing user to admin role');
      }
      return;
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('omjain', salt);

    // Create admin user
    const adminUser = new User({
      email: 'om@gmail.com',
      phone: '0000000000',
      password: hashedPassword,
      role: 'admin' // Explicitly set role to admin
    });

    const savedAdmin = await adminUser.save();
    console.log('🔑 Admin user created successfully');
    console.log('📧 Email:', savedAdmin.email);
    console.log('👤 Role:', savedAdmin.role);
    console.log('🆔 ID:', savedAdmin._id);
  } catch (error) {
    console.error('❌ Error seeding admin user:', error);
  }
};

// Seed admin user after database connection
const initializeApp = async () => {
  try {
    await seedAdminUser();
  } catch (error) {
    console.error('Error initializing app:', error);
  }
};

// Call initialization function
initializeApp();

// CORS Options Configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:8080',
      'https://civicsync-resolve-livid.vercel.app',
      'https://civicsync-resolve-om-jains-projects.vercel.app',
      'https://civicsync-resolve-a9i7lflgd-om-jains-projects.vercel.app'
    ];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'X-Requested-With', 'Accept']
};

// Middleware
// Apply CORS with options
app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Import and use routes
const authRoutes = require('./routes/auth');
const reportsRoutes = require('./routes/reports');

app.use('/api/auth', authRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/auth', authRoutes);
app.use('/reports', reportsRoutes);
// Test route to verify server is working
app.get('/', (req, res) => {
  res.json({ 
    message: 'Server is running!',
    timestamp: new Date().toISOString()
  });
});

// 404 handler for debugging
app.use('*', (req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    message: `Route ${req.method} ${req.originalUrl} not found` 
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Server Error' 
  });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
  console.log(`🌐 CORS enabled for allowed origins`);
});
