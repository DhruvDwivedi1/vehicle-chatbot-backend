const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../config/database'); // mysql2/promise pool

// ===============================
// REGISTER
// ===============================
router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
    body('phone_number').optional().isMobilePhone(),
    body('location').optional().trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password, phone_number, location } = req.body;

    try {
      // Check if user exists
      console.log('Checking if user exists for email:', email);
      const [existing] = await db.query(
        'SELECT user_id FROM user WHERE email = ?',
        [email]
      );

      if (existing.length > 0) {
        console.log('Email already registered:', email);
        return res.status(400).json({ message: 'Email already registered' });
      }

      // Hash password
      const password_hash = await bcrypt.hash(password, 10);
      console.log('Password hashed for:', email);

      // Insert user
      console.log('Inserting new user into DB:', { name, email, phone_number, location });
      const [result] = await db.query(
        'INSERT INTO user (name, email, password_hash, phone_number, location) VALUES (?, ?, ?, ?, ?)',
        [name, email, password_hash, phone_number || null, location || null]
      );
      console.log('User inserted with ID:', result.insertId);

      // Generate token
      const token = jwt.sign(
        { user_id: result.insertId, email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE }
      );
      console.log('JWT token generated for user:', email);

      res.status(201).json({
        message: 'User registered successfully',
        token,
        user: { user_id: result.insertId, name, email },
      });
    } catch (error) {
      console.error(
        'Registration error:',
        error.sqlMessage || error.message || error
      );
      res.status(500).json({
        message: 'Server error during registration',
        error: error.sqlMessage || error.message || error, // useful for debugging
      });
    }
  }
);

// ===============================
// LOGIN
// ===============================
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      console.log('Fetching user for login:', email);
      const [users] = await db.query('SELECT * FROM user WHERE email = ?', [email]);

      if (users.length === 0) {
        console.log('No user found with email:', email);
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const user = users[0];
      const isValidPassword = await bcrypt.compare(password, user.password_hash);

      if (!isValidPassword) {
        console.log('Invalid password for email:', email);
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // Update last active timestamp
      await db.query('UPDATE user SET last_active = NOW() WHERE user_id = ?', [user.user_id]);
      console.log('Last active updated for user:', email);

      const token = jwt.sign(
        { user_id: user.user_id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE }
      );

      res.json({
        message: 'Login successful',
        token,
        user: {
          user_id: user.user_id,
          name: user.name,
          email: user.email,
        },
      });
    } catch (error) {
      console.error('Login error:', error.sqlMessage || error.message || error);
      res.status(500).json({
        message: 'Server error during login',
        error: error.sqlMessage || error.message || error,
      });
    }
  }
);

module.exports = router;
