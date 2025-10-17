// server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Route imports
const authRoutes = require('./routes/auth');
const vehicleRoutes = require('./routes/vehicles');
const recommendationRoutes = require('./routes/recommendations');
const conversationRoutes = require('./routes/conversations');
const preferenceRoutes = require('./routes/preferences');

const app = express();

// --- CORS setup ---
const allowedOrigins = [
  'http://localhost:3000', // local dev
  'https://vehicle-chatbot-frontend.vercel.app', // production frontend
];

app.use(cors({
  origin: function(origin, callback){
    // allow requests with no origin (like Postman)
    if(!origin) return callback(null, true);
    if(allowedOrigins.indexOf(origin) === -1){
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
}));

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple request logger
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/recommend', recommendationRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/preferences', preferenceRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ message: err.message || 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
