const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { scoreVehicle, parseUserQuery } = require('../utils/recommendationEngine');

// Get recommendations
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { preferences, query } = req.body;
    let filters = preferences || {};

    // If query provided, parse it
    if (query) {
      const parsedFilters = parseUserQuery(query);
      filters = { ...filters, ...parsedFilters };
    }

    // Build SQL query
    let sqlQuery = 'SELECT * FROM VEHICLE WHERE availability_status = "Available"';
    const params = [];

    if (filters.budget_min) {
      sqlQuery += ' AND price >= ?';
      params.push(filters.budget_min);
    }
    if (filters.budget_max) {
      sqlQuery += ' AND price <= ?';
      params.push(filters.budget_max);
    }
    if (filters.vehicle_type) {
      sqlQuery += ' AND vehicle_type = ?';
      params.push(filters.vehicle_type);
    }
    if (filters.fuel_type) {
      sqlQuery += ' AND fuel_type = ?';
      params.push(filters.fuel_type);
    }
    if (filters.transmission) {
      sqlQuery += ' AND transmission = ?';
      params.push(filters.transmission);
    }
    if (filters.make) {
      sqlQuery += ' AND make = ?';
      params.push(filters.make);
    }
    if (filters.seating_needed) {
      sqlQuery += ' AND seating_capacity >= ?';
      params.push(filters.seating_needed);
    }

    const [vehicles] = await db.query(sqlQuery, params);

    // Score and sort vehicles
    const scoredVehicles = vehicles.map(vehicle => ({
      ...vehicle,
      recommendation_score: scoreVehicle(vehicle, filters)
    })).sort((a, b) => b.recommendation_score - a.recommendation_score);

    // Take top 10
    const recommendations = scoredVehicles.slice(0, 10);

    // Log recommendation
    const vehicleIds = recommendations.map(v => v.vehicle_id);
    await db.query(
      'INSERT INTO RECOMMENDATION_LOG (user_id, recommended_vehicle_ids, filters_applied) VALUES (?, ?, ?)',
      [req.user.user_id, JSON.stringify(vehicleIds), JSON.stringify(filters)]
    );

    res.json({
      recommendations,
      filters_applied: filters,
      total_matches: vehicles.length
    });
  } catch (error) {
    console.error('Recommendation error:', error);
    res.status(500).json({ message: 'Error generating recommendations' });
  }
});

// Compare vehicles
router.post('/compare', authenticateToken, async (req, res) => {
  try {
    const { vehicle_ids } = req.body;

    if (!vehicle_ids || vehicle_ids.length < 2) {
      return res.status(400).json({ message: 'At least 2 vehicle IDs required' });
    }

    const placeholders = vehicle_ids.map(() => '?').join(',');
    const [vehicles] = await db.query(
      `SELECT * FROM VEHICLE WHERE vehicle_id IN (${placeholders})`,
      vehicle_ids
    );

    // Log comparison
    await db.query(
      'INSERT INTO VEHICLE_COMPARISON (user_id, vehicle_ids) VALUES (?, ?)',
      [req.user.user_id, JSON.stringify(vehicle_ids)]
    );

    res.json({ vehicles });
  } catch (error) {
    console.error('Compare error:', error);
    res.status(500).json({ message: 'Error comparing vehicles' });
  }
});

module.exports = router;