const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Get your Vercel frontend URL
const allowedOrigins = [
  'http://localhost:3000',
  'https://vehicle-chatbot-frontend.vercel.app', // UPDATE THIS with YOUR Vercel URL
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Your routes
app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/recommend', recommendationRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/preferences', preferenceRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
});

module.exports = app;