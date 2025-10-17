const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Get user preferences
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [preferences] = await db.query(
      'SELECT * FROM USER_PREFERENCE WHERE user_id = ?',
      [req.user.user_id]
    );

    if (preferences.length === 0) {
      return res.json({ preferences: null, hasPreferences: false });
    }

    res.json({ preferences: preferences[0], hasPreferences: true });
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ message: 'Error fetching preferences' });
  }
});

// Save/Update preferences
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      budget_min,
      budget_max,
      preferred_vehicle_types,
      preferred_brands,
      fuel_type_preference,
      transmission_preference,
      must_have_features,
      seating_needed,
      primary_use_case
    } = req.body;

    // Check if preferences exist
    const [existing] = await db.query(
      'SELECT preference_id FROM USER_PREFERENCE WHERE user_id = ?',
      [req.user.user_id]
    );

    if (existing.length > 0) {
      // Update
      await db.query(
        `UPDATE USER_PREFERENCE SET 
         budget_min = ?, budget_max = ?, preferred_vehicle_types = ?, 
         preferred_brands = ?, fuel_type_preference = ?, transmission_preference = ?,
         must_have_features = ?, seating_needed = ?, primary_use_case = ?
         WHERE user_id = ?`,
        [
          budget_min, budget_max, JSON.stringify(preferred_vehicle_types || []),
          JSON.stringify(preferred_brands || []), fuel_type_preference, transmission_preference,
          JSON.stringify(must_have_features || []), seating_needed, primary_use_case,
          req.user.user_id
        ]
      );
    } else {
      // Insert
      await db.query(
        `INSERT INTO USER_PREFERENCE 
         (user_id, budget_min, budget_max, preferred_vehicle_types, preferred_brands,
          fuel_type_preference, transmission_preference, must_have_features, seating_needed, primary_use_case)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.user_id, budget_min, budget_max, JSON.stringify(preferred_vehicle_types || []),
          JSON.stringify(preferred_brands || []), fuel_type_preference, transmission_preference,
          JSON.stringify(must_have_features || []), seating_needed, primary_use_case
        ]
      );
    }

    res.json({ message: 'Preferences saved successfully', success: true });
  } catch (error) {
    console.error('Save preferences error:', error);
    res.status(500).json({ message: 'Error saving preferences' });
  }
});

// Get personalized recommendations based on saved preferences
router.get('/recommendations', authenticateToken, async (req, res) => {
  try {
    const [preferences] = await db.query(
      'SELECT * FROM USER_PREFERENCE WHERE user_id = ?',
      [req.user.user_id]
    );

    if (preferences.length === 0) {
      return res.status(404).json({ message: 'No preferences found. Please set your preferences first.' });
    }

    const pref = preferences[0];
    
    // Build query based on preferences
    let query = 'SELECT * FROM VEHICLE WHERE availability_status = "Available"';
    const params = [];

    if (pref.budget_min || pref.budget_max) {
      if (pref.budget_min) {
        query += ' AND price >= ?';
        params.push(pref.budget_min);
      }
      if (pref.budget_max) {
        query += ' AND price <= ?';
        params.push(pref.budget_max);
      }
    }

    if (pref.fuel_type_preference) {
      query += ' AND fuel_type = ?';
      params.push(pref.fuel_type_preference);
    }

    if (pref.transmission_preference) {
      query += ' AND transmission = ?';
      params.push(pref.transmission_preference);
    }

    if (pref.seating_needed) {
      query += ' AND seating_capacity >= ?';
      params.push(pref.seating_needed);
    }

    query += ' ORDER BY price ASC';

    const [vehicles] = await db.query(query, params);

    // Score vehicles based on preferences
    const { scoreVehicle } = require('../utils/recommendationEngine');
    const scoredVehicles = vehicles.map(vehicle => ({
      ...vehicle,
      recommendation_score: scoreVehicle(vehicle, {
        budget_max: pref.budget_max,
        seating_needed: pref.seating_needed,
        must_have_features: JSON.parse(pref.must_have_features || '[]'),
        primary_use_case: pref.primary_use_case
      })
    })).sort((a, b) => b.recommendation_score - a.recommendation_score);

    res.json({
      vehicles: scoredVehicles.slice(0, 10),
      preferences: pref,
      message: 'Personalized recommendations based on your preferences'
    });
  } catch (error) {
    console.error('Get recommendations error:', error);
    res.status(500).json({ message: 'Error getting recommendations' });
  }
});

// Delete user preferences
router.delete('/delete', authenticateToken, async (req, res) => {
  try {
    const [result] = await db.query(
      'DELETE FROM USER_PREFERENCE WHERE user_id = ?',
      [req.user.user_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'No preferences found to delete' });
    }

    res.json({ message: 'Preferences deleted successfully', success: true });
  } catch (error) {
    console.error('Delete preferences error:', error);
    res.status(500).json({ message: 'Error deleting preferences' });
  }
});

module.exports = router;