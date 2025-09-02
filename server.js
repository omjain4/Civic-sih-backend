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


// Middleware
// Simple CORS fix - allows all origins temporarily
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests immediately
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS request for:', req.url);
    return res.status(200).end();
  }
  
  next();
});
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import and use routes - THIS IS CRITICAL
const authRoutes = require('./routes/auth');

const reportsRoutes = require('./routes/reports');
app.use('/auth', authRoutes);
app.use('/reports', reportsRoutes); 

// Test route to verify server is working
app.get('/', (req, res) => {
  res.json({ message: 'Server is running!' });
});

// 404 handler for debugging
app.use('*', (req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ message: `Route ${req.method} ${req.originalUrl} not found` });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});

// Removed duplicate code that redeclares "app" and its associated routes and server listen