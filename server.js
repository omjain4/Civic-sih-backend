const bcrypt = require('bcryptjs');
const User = require('./models/User');

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db'); // Adjust path to your DB config

const app = express();

// Connect to database
connectDB();

// Middleware
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:8080',
      'https://civicsync-resolve-livid.vercel.app',
      'https://civicsync-resolve-om-jains-projects.vercel.app'
    ];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

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