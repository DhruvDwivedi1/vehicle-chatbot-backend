const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Get all vehicles with filters
router.get('/', async (req, res) => {
  try {
    const {
      budget_min,
      budget_max,
      vehicle_type,
      fuel_type,
      transmission,
      make,
      seating_capacity,
      page = 1,
      limit = 20
    } = req.query;

    let query = 'SELECT * FROM VEHICLE WHERE availability_status = "Available"';
    const params = [];

    if (budget_min) {
      query += ' AND price >= ?';
      params.push(parseFloat(budget_min));
    }
    if (budget_max) {
      query += ' AND price <= ?';
      params.push(parseFloat(budget_max));
    }
    if (vehicle_type) {
      query += ' AND vehicle_type = ?';
      params.push(vehicle_type);
    }
    if (fuel_type) {
      query += ' AND fuel_type = ?';
      params.push(fuel_type);
    }
    if (transmission) {
      query += ' AND transmission = ?';
      params.push(transmission);
    }
    if (make) {
      query += ' AND make = ?';
      params.push(make);
    }
    if (seating_capacity) {
      query += ' AND seating_capacity >= ?';
      params.push(parseInt(seating_capacity));
    }

    query += ' ORDER BY price ASC';
    
    const offset = (page - 1) * limit;
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const [vehicles] = await db.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM VEHICLE WHERE availability_status = "Available"';
    const countParams = params.slice(0, -2); // Remove limit and offset
    const [countResult] = await db.query(countQuery.replace('SELECT *', 'SELECT COUNT(*) as total').replace(/LIMIT.*/, ''), countParams);

    res.json({
      vehicles,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        pages: Math.ceil(countResult[0].total / limit)
      }
    });
  } catch (error) {
    console.error('Get vehicles error:', error);
    res.status(500).json({ message: 'Error fetching vehicles' });
  }
});

// Get single vehicle by ID
router.get('/:id', async (req, res) => {
  try {
    const [vehicles] = await db.query('SELECT * FROM VEHICLE WHERE vehicle_id = ?', [req.params.id]);
    
    if (vehicles.length === 0) {
      return res.status(404).json({ message: 'Vehicle not found' });
    }

    res.json(vehicles[0]);
  } catch (error) {
    console.error('Get vehicle error:', error);
    res.status(500).json({ message: 'Error fetching vehicle' });
  }
});

// Search vehicles
router.get('/search/query', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({ message: 'Search query required' });
    }

    const searchTerm = `%${q}%`;
    const [vehicles] = await db.query(
      `SELECT * FROM VEHICLE 
       WHERE (make LIKE ? OR model LIKE ? OR description LIKE ?)
       AND availability_status = "Available"
       LIMIT 20`,
      [searchTerm, searchTerm, searchTerm]
    );

    res.json({ vehicles });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ message: 'Error searching vehicles' });
  }
});

module.exports = router;