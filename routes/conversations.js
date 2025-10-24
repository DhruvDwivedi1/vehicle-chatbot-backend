const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { parseUserQuery } = require('../utils/recommendationEngine');

// Start new conversation
router.post('/', authenticateToken, async (req, res) => {
  try {
    const [result] = await db.query(
      'INSERT INTO CONVERSATION (user_id, status) VALUES (?, "active")',
      [req.user.user_id]
    );

    res.json({
      conversation_id: result.insertId,
      message: 'Conversation started'
    });
  } catch (error) {
    console.error('Start conversation error:', error);
    res.status(500).json({ message: 'Error starting conversation' });
  }
});

// Get user conversations
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [conversations] = await db.query(
      `SELECT c.*, 
        (SELECT content FROM MESSAGE WHERE conversation_id = c.conversation_id ORDER BY timestamp DESC LIMIT 1) as last_message,
        (SELECT timestamp FROM MESSAGE WHERE conversation_id = c.conversation_id ORDER BY timestamp DESC LIMIT 1) as last_message_time
       FROM CONVERSATION c 
       WHERE user_id = ? 
       ORDER BY start_time DESC`,
      [req.user.user_id]
    );

    res.json({ conversations });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ message: 'Error fetching conversations' });
  }
});

// Get conversation messages
router.get('/:id/messages', authenticateToken, async (req, res) => {
  try {
    const [messages] = await db.query(
      'SELECT * FROM MESSAGE WHERE conversation_id = ? ORDER BY timestamp ASC',
      [req.params.id]
    );

    res.json({ messages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ message: 'Error fetching messages' });
  }
});

// Send message
router.post('/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { content, vehicleIds } = req.body;
    const conversation_id = req.params.id;

    // Save user message
    await db.query(
      'INSERT INTO MESSAGE (conversation_id, sender, content) VALUES (?, "user", ?)',
      [conversation_id, content]
    );

    // Generate bot response
    const botResponse = await generateBotResponse(content, req.user.user_id, vehicleIds);

    // Validate bot response has required structure
    if (!botResponse || !botResponse.type) {
      console.error('Invalid bot response structure:', botResponse);
      throw new Error('Bot response missing required type property');
    }

    // Save bot message
    await db.query(
      'INSERT INTO MESSAGE (conversation_id, sender, content) VALUES (?, "bot", ?)',
      [conversation_id, JSON.stringify(botResponse)]
    );

    res.json({ 
      user_message: content,
      bot_response: botResponse
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ 
      message: 'Error sending message',
      bot_response: {
        type: 'text',
        content: 'Sorry, I encountered an error. Please try again.',
        quick_actions: [
          { label: 'Browse All', action: 'browse_all' },
          { label: 'Start Over', action: 'find_car' }
        ]
      }
    });
  }
});

// Close conversation
router.put('/:id/close', authenticateToken, async (req, res) => {
  try {
    await db.query(
      'UPDATE CONVERSATION SET status = "closed", end_time = NOW() WHERE conversation_id = ?',
      [req.params.id]
    );

    res.json({ message: 'Conversation closed' });
  } catch (error) {
    console.error('Close conversation error:', error);
    res.status(500).json({ message: 'Error closing conversation' });
  }
});

// Bot response generator
async function generateBotResponse(userMessage, userId, vehicleIds = null) {
  const lowerMessage = userMessage.toLowerCase();

  // Greeting - Check if user has preferences
  if (lowerMessage.match(/^(hi|hello|hey|good morning|good evening)/)) {
    const [preferences] = await db.query(
      'SELECT * FROM USER_PREFERENCE WHERE user_id = ?',
      [userId]
    );

    if (preferences.length > 0) {
      return {
        type: 'text',
        content: 'Hi! Welcome back! I remember your preferences. Would you like to see personalized recommendations or start fresh?',
        quick_actions: [
          { label: '⭐ My Recommendations', action: 'my_recommendations' },
          { label: '⚙️ Update Preferences', action: 'update_preferences' },
          { label: '🔍 Browse All', action: 'browse_all' }
        ]
      };
    }

    return {
      type: 'text',
      content: 'Hi! I\'m your vehicle advisor. I can help you find the perfect car based on your needs and budget. What are you looking for today?',
      quick_actions: [
        { label: '🚗 Find a car', action: 'find_car' },
        { label: '💰 Set Budget', action: 'set_budget' },
        { label: '🔍 Browse All', action: 'browse_all' },
        { label: '⚙️ Set Preferences', action: 'set_preferences' }
      ]
    };
  }

  // My Recommendations
  if (lowerMessage.includes('my recommendations') || lowerMessage.includes('personalized') || lowerMessage.includes('for me')) {
    const [preferences] = await db.query(
      'SELECT * FROM USER_PREFERENCE WHERE user_id = ?',
      [userId]
    );

    if (preferences.length === 0) {
      return {
        type: 'text',
        content: 'You haven\'t set your preferences yet. Let me help you set them up!',
        quick_actions: [
          { label: 'Set Preferences', action: 'set_preferences' },
          { label: 'Browse All', action: 'browse_all' }
        ]
      };
    }

    const pref = preferences[0];
    let query = 'SELECT * FROM VEHICLE WHERE availability_status = "Available"';
    const params = [];

    if (pref.budget_max) {
      query += ' AND price <= ?';
      params.push(pref.budget_max);
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

    query += ' ORDER BY price ASC LIMIT 10';
    const [vehicles] = await db.query(query, params);

    if (vehicles.length === 0) {
      return {
        type: 'text',
        content: 'No vehicles match your exact preferences. Would you like to adjust them or browse all vehicles?',
        quick_actions: [
          { label: 'Update Preferences', action: 'update_preferences' },
          { label: 'Browse All', action: 'browse_all' }
        ]
      };
    }

    return {
      type: 'vehicle_list',
      content: `Based on your preferences, here are ${vehicles.length} vehicles perfect for you:`,
      vehicles: vehicles,
      quick_actions: [
        { label: 'Compare These', action: 'compare' },
        { label: 'Update Preferences', action: 'update_preferences' }
      ]
    };
  }

  // Set/Update Preferences
  if (lowerMessage.includes('set preferences') || lowerMessage.includes('update preferences') || lowerMessage.includes('my preferences')) {
    return {
      type: 'preferences_form',
      content: 'Let me help you set your preferences. This will help me give you better recommendations!',
      quick_actions: [
        { label: 'Skip for now', action: 'browse_all' }
      ]
    };
  }

  // Handle comparison request
  if (lowerMessage.includes('compare') || lowerMessage.includes('comparison')) {
    try {
      console.log('=== COMPARISON REQUEST ===');
      console.log('User message:', userMessage);
      console.log('Vehicle IDs provided:', vehicleIds);
      
      const carNames = ['creta', 'nexon', 'city', 'swift', 'baleno', 'venue', 'seltos', 'scorpio', 
                        'fortuner', 'innova', 'punch', 'brezza', 'verna', 'amaze', 'harrier', 
                        'safari', 'xuv', 'thar', 'sonet', 'carens', 'ertiga'];
      
      const mentionedCars = carNames.filter(name => lowerMessage.includes(name));
      console.log('Mentioned car names:', mentionedCars);
      
      if (mentionedCars.length >= 2) {
        const likeConditions = mentionedCars.map(() => '(LOWER(model) LIKE ? OR LOWER(make) LIKE ?)').join(' OR ');
        const params = mentionedCars.flatMap(name => [`%${name}%`, `%${name}%`]);
        params.push('Available');
        
        const [vehicles] = await db.query(
          `SELECT * FROM VEHICLE WHERE (${likeConditions}) AND availability_status = ?`,
          params
        );

        if (vehicles.length >= 2) {
          const compareIds = vehicles.map(v => v.vehicle_id);
          await db.query(
            'INSERT INTO VEHICLE_COMPARISON (user_id, vehicle_ids) VALUES (?, ?)',
            [userId, JSON.stringify(compareIds)]
          );

          return {
            type: 'comparison',
            content: `Here's a comparison of ${vehicles.length} vehicles (${mentionedCars.join(', ')}):`,
            vehicles: vehicles,
            quick_actions: [
              { label: 'View Details', action: 'details' },
              { label: 'New Search', action: 'browse_all' }
            ]
          };
        } else if (vehicles.length === 1) {
          return {
            type: 'text',
            content: `I found only 1 vehicle matching ${mentionedCars.join(', ')}. I need at least 2 vehicles to compare.`,
            quick_actions: [
              { label: 'Browse All', action: 'browse_all' },
              { label: 'Search Again', action: 'find_car' }
            ]
          };
        } else {
          return {
            type: 'text',
            content: `I couldn't find any vehicles matching ${mentionedCars.join(', ')}.`,
            quick_actions: [
              { label: 'Browse All', action: 'browse_all' },
              { label: 'Search Again', action: 'find_car' }
            ]
          };
        }
      }

      if (vehicleIds && Array.isArray(vehicleIds) && vehicleIds.length >= 2) {
        const placeholders = vehicleIds.map(() => '?').join(',');
        const [vehicles] = await db.query(
          `SELECT * FROM VEHICLE WHERE vehicle_id IN (${placeholders})`,
          vehicleIds
        );

        if (vehicles.length >= 2) {
          await db.query(
            'INSERT INTO VEHICLE_COMPARISON (user_id, vehicle_ids) VALUES (?, ?)',
            [userId, JSON.stringify(vehicleIds)]
          );

          return {
            type: 'comparison',
            content: `Here's a comparison of ${vehicles.length} vehicles:`,
            vehicles: vehicles,
            quick_actions: [
              { label: 'View Details', action: 'details' },
              { label: 'New Search', action: 'browse_all' }
            ]
          };
        }
      }

      const [recentRecommendations] = await db.query(
        `SELECT recommended_vehicle_ids FROM RECOMMENDATION_LOG 
         WHERE user_id = ? 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [userId]
      );

      if (recentRecommendations.length > 0 && recentRecommendations[0].recommended_vehicle_ids) {
        let allVehicleIds;
        try {
          allVehicleIds = typeof recentRecommendations[0].recommended_vehicle_ids === 'string'
            ? JSON.parse(recentRecommendations[0].recommended_vehicle_ids)
            : recentRecommendations[0].recommended_vehicle_ids;
          
          if (!Array.isArray(allVehicleIds)) {
            allVehicleIds = [];
          }
        } catch (error) {
          console.error('Error parsing vehicle IDs:', error);
          allVehicleIds = [];
        }
        
        if (allVehicleIds.length >= 2) {
          const placeholders = allVehicleIds.map(() => '?').join(',');
          const [vehicles] = await db.query(
            `SELECT * FROM VEHICLE WHERE vehicle_id IN (${placeholders})`,
            allVehicleIds
          );

          if (vehicles.length >= 2) {
            await db.query(
              'INSERT INTO VEHICLE_COMPARISON (user_id, vehicle_ids) VALUES (?, ?)',
              [userId, JSON.stringify(allVehicleIds)]
            );

            return {
              type: 'comparison',
              content: `Here's a comparison of all ${vehicles.length} vehicles from your search:`,
              vehicles: vehicles,
              quick_actions: [
                { label: 'View Details', action: 'details' },
                { label: 'New Search', action: 'browse_all' }
              ]
            };
          }
        }
      }
    } catch (error) {
      console.error('Comparison error:', error);
    }

    return {
      type: 'text',
      content: 'To compare vehicles, you can:\n\n• Type "compare creta and venue"\n• First search for cars, then type "compare these"\n• Click "Browse All" and then compare button',
      quick_actions: [
        { label: '🔍 Browse All', action: 'browse_all' },
        { label: '💰 Set Budget', action: 'set_budget' },
        { label: '🚗 Find a car', action: 'find_car' }
      ]
    };
  }

  // Search by car name/model
  if (lowerMessage.includes('creta') || lowerMessage.includes('nexon') || lowerMessage.includes('city') || 
      lowerMessage.includes('swift') || lowerMessage.includes('baleno') || lowerMessage.includes('venue') ||
      lowerMessage.includes('seltos') || lowerMessage.includes('scorpio') || lowerMessage.includes('fortuner') ||
      lowerMessage.includes('innova') || lowerMessage.includes('punch') || lowerMessage.includes('brezza') ||
      lowerMessage.includes('verna') || lowerMessage.includes('amaze') || lowerMessage.includes('harrier') ||
      lowerMessage.includes('safari') || lowerMessage.includes('xuv') || lowerMessage.includes('thar') ||
      lowerMessage.includes('sonet') || lowerMessage.includes('carens') || lowerMessage.includes('ertiga')) {
    
    const carNames = ['creta', 'nexon', 'city', 'swift', 'baleno', 'venue', 'seltos', 'scorpio', 
                      'fortuner', 'innova', 'punch', 'brezza', 'verna', 'amaze', 'harrier', 
                      'safari', 'xuv', 'thar', 'sonet', 'carens', 'ertiga'];
    
    let searchTerm = '';
    for (const name of carNames) {
      if (lowerMessage.includes(name)) {
        searchTerm = name;
        break;
      }
    }

    if (searchTerm) {
      const [vehicles] = await db.query(
        `SELECT * FROM VEHICLE 
         WHERE LOWER(model) LIKE ? OR LOWER(make) LIKE ?
         AND availability_status = "Available"
         ORDER BY price ASC`,
        [`%${searchTerm}%`, `%${searchTerm}%`]
      );

      if (vehicles.length > 0) {
        const vehicleIds = vehicles.map(v => v.vehicle_id);
        await db.query(
          'INSERT INTO RECOMMENDATION_LOG (user_id, recommended_vehicle_ids, filters_applied) VALUES (?, ?, ?)',
          [userId, JSON.stringify(vehicleIds), JSON.stringify({ search: searchTerm })]
        );

        return {
          type: 'vehicle_list',
          content: `Found ${vehicles.length} vehicle(s) matching "${searchTerm}":`,
          vehicles: vehicles,
          quick_actions: [
            { label: 'Compare These', action: 'compare' },
            { label: 'View Details', action: 'details' },
            { label: 'New Search', action: 'browse_all' }
          ]
        };
      } else {
        return {
          type: 'text',
          content: `Sorry, I couldn't find any vehicles matching "${searchTerm}".`,
          quick_actions: [
            { label: 'Browse All', action: 'browse_all' },
            { label: 'SUVs', action: 'suv' },
            { label: 'Sedans', action: 'sedan' }
          ]
        };
      }
    }
  }

  // Browse all vehicles
  if (lowerMessage.includes('browse all') || lowerMessage.includes('show me all') || lowerMessage.includes('all vehicles') || lowerMessage.includes('all cars')) {
    const [vehicles] = await db.query(
      'SELECT * FROM VEHICLE WHERE availability_status = "Available" ORDER BY price ASC LIMIT 15'
    );

    const vehicleIds = vehicles.map(v => v.vehicle_id);
    await db.query(
      'INSERT INTO RECOMMENDATION_LOG (user_id, recommended_vehicle_ids, filters_applied) VALUES (?, ?, ?)',
      [userId, JSON.stringify(vehicleIds), JSON.stringify({ action: 'browse_all' })]
    );

    return {
      type: 'vehicle_list',
      content: `Here are all available vehicles in our inventory (${vehicles.length} vehicles):`,
      vehicles: vehicles,
      quick_actions: [
        { label: 'Filter by Type', action: 'choose_type' },
        { label: 'Set Budget', action: 'set_budget' },
        { label: 'Compare These', action: 'compare' }
      ]
    };
  }

  // Show all vehicles within budget
  if (lowerMessage.includes('show all in budget') || lowerMessage === 'show all') {
    const [preferences] = await db.query(
      'SELECT budget_max FROM USER_PREFERENCE WHERE user_id = ?',
      [userId]
    );

    if (preferences.length > 0 && preferences[0].budget_max) {
      const budgetMax = preferences[0].budget_max;
      
      const [vehicles] = await db.query(
        'SELECT * FROM VEHICLE WHERE price <= ? AND availability_status = "Available" ORDER BY price ASC LIMIT 15',
        [budgetMax]
      );

      const vehicleIds = vehicles.map(v => v.vehicle_id);
      await db.query(
        'INSERT INTO RECOMMENDATION_LOG (user_id, recommended_vehicle_ids, filters_applied) VALUES (?, ?, ?)',
        [userId, JSON.stringify(vehicleIds), JSON.stringify({ budget_max: budgetMax, action: 'show_all_in_budget' })]
      );

      return {
        type: 'vehicle_list',
        content: `Here are all ${vehicles.length} vehicles within your budget of ₹${budgetMax/100000} lakhs:`,
        vehicles: vehicles,
        quick_actions: [
          { label: 'Filter by Type', action: 'choose_type' },
          { label: 'Change Budget', action: 'set_budget' },
          { label: 'Compare These', action: 'compare' }
        ]
      };
    } else {
      return {
        type: 'text',
        content: 'Please set your budget first!',
        quick_actions: [
          { label: 'Set Budget', action: 'set_budget' }
        ]
      };
    }
  }

  // COMBINED QUERY HANDLER - vehicle type + budget
  if ((lowerMessage.includes('suv') || lowerMessage.includes('sedan') || 
       lowerMessage.includes('hatchback') || lowerMessage.includes('muv')) &&
      (lowerMessage.includes('lakh') || lowerMessage.includes('budget') || 
       lowerMessage.includes('under') || lowerMessage.includes('below') || 
       lowerMessage.includes('between') || lowerMessage.includes('above'))) {
    
    const filters = parseUserQuery(userMessage);
    
    if (filters.budget_max) {
      const [existingPref] = await db.query(
        'SELECT * FROM USER_PREFERENCE WHERE user_id = ?',
        [userId]
      );

      if (existingPref.length > 0) {
        await db.query(
          'UPDATE USER_PREFERENCE SET budget_max = ? WHERE user_id = ?',
          [filters.budget_max, userId]
        );
      } else {
        await db.query(
          'INSERT INTO USER_PREFERENCE (user_id, budget_max) VALUES (?, ?)',
          [userId, filters.budget_max]
        );
      }
    }

    let query = 'SELECT * FROM VEHICLE WHERE availability_status = "Available"';
    const params = [];

    if (filters.vehicle_type) {
      query += ' AND LOWER(vehicle_type) = LOWER(?)';
      params.push(filters.vehicle_type);
    }
    if (filters.budget_max) {
      query += ' AND price <= ?';
      params.push(filters.budget_max);
    }
    if (filters.transmission) {
      query += ' AND transmission = ?';
      params.push(filters.transmission);
    }
    if (filters.fuel_type) {
      query += ' AND fuel_type = ?';
      params.push(filters.fuel_type);
    }

    query += ' ORDER BY price ASC';

    const [vehicles] = await db.query(query, params);

    if (vehicles.length === 0) {
      return {
        type: 'text',
        content: `Sorry, no ${filters.vehicle_type || 'vehicles'} found${filters.budget_max ? ` under ₹${filters.budget_max/100000}L` : ''}.`,
        quick_actions: [
          { label: 'Browse All', action: 'browse_all' },
          { label: 'Change Budget', action: 'set_budget' },
          { label: 'Different Type', action: 'choose_type' }
        ]
      };
    }

    const vehicleIds = vehicles.map(v => v.vehicle_id);
    await db.query(
      'INSERT INTO RECOMMENDATION_LOG (user_id, recommended_vehicle_ids, filters_applied) VALUES (?, ?, ?)',
      [userId, JSON.stringify(vehicleIds), JSON.stringify(filters)]
    );

    return {
      type: 'vehicle_list',
      content: `Found ${vehicles.length} ${filters.vehicle_type || 'vehicle'}(s)${filters.budget_max ? ` under ₹${filters.budget_max/100000}L` : ''}:`,
      vehicles: vehicles,
      quick_actions: [
        { label: 'Add Filters', action: 'refine' },
        { label: 'Compare These', action: 'compare' },
        { label: 'New Search', action: 'browse_all' }
      ]
    };
  }

  // Choose vehicle type
  if (lowerMessage.includes('choose type') || lowerMessage.includes('vehicle type') || 
      lowerMessage.includes('select type') || lowerMessage === 'find a car' || 
      lowerMessage === 'find car' || lowerMessage === 'i want to find') {
    const [preferences] = await db.query(
      'SELECT budget_max FROM USER_PREFERENCE WHERE user_id = ?',
      [userId]
    );

    const budgetText = preferences.length > 0 && preferences[0].budget_max 
      ? ` (Budget: ₹${preferences[0].budget_max/100000}L)` 
      : '';

    return {
      type: 'text',
      content: `What type of vehicle are you looking for?${budgetText}`,
      quick_actions: [
        { label: '🚗 Hatchback', value: 'hatchback' },
        { label: '🚙 Sedan', value: 'sedan' },
        { label: '🚐 SUV', value: 'suv' },
        { label: '🚌 MUV', value: 'muv' },
        { label: '💰 Set Budget', action: 'set_budget' },
        { label: '🏎️ All Types', action: 'browse_all' }
      ]
    };
  }

  // Handle specific vehicle type selection
  if (lowerMessage === 'hatchback' || lowerMessage === 'sedan' || lowerMessage === 'suv' || lowerMessage === 'muv') {
    const [userPreferences] = await db.query(
      'SELECT budget_max FROM USER_PREFERENCE WHERE user_id = ?',
      [userId]
    );

    let savedBudget = null;

    if (userPreferences.length > 0) {
      savedBudget = userPreferences[0].budget_max;
    }

    if (!savedBudget) {
      const [recentRecommendations] = await db.query(
        `SELECT filters_applied FROM RECOMMENDATION_LOG 
         WHERE user_id = ? 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [userId]
      );

      if (recentRecommendations.length > 0 && recentRecommendations[0].filters_applied) {
        try {
          const previousFilters = typeof recentRecommendations[0].filters_applied === 'string'
            ? JSON.parse(recentRecommendations[0].filters_applied)
            : recentRecommendations[0].filters_applied;
          
          savedBudget = previousFilters.budget_max;
        } catch (error) {
          console.error('Error parsing previous filters:', error);
        }
      }
    }

    const vehicleType = lowerMessage.charAt(0).toUpperCase() + lowerMessage.slice(1);
    
    let query = 'SELECT * FROM VEHICLE WHERE LOWER(vehicle_type) = LOWER(?) AND availability_status = "Available"';
    const params = [vehicleType];
    
    if (savedBudget) {
      query += ' AND price <= ?';
      params.push(savedBudget);
    }

    query += ' ORDER BY price ASC';

    const [vehicles] = await db.query(query, params);

    if (vehicles.length === 0) {
      return {
        type: 'text',
        content: `Sorry, we don't have any ${vehicleType}s${savedBudget ? ` within ₹${savedBudget/100000}L budget` : ''}.`,
        quick_actions: [
          { label: 'Browse All', action: 'browse_all' },
          { label: 'Choose Different Type', action: 'choose_type' },
          { label: 'Change Budget', action: 'set_budget' }
        ]
      };
    }

    const appliedFilters = { 
      vehicle_type: vehicleType,
      budget_max: savedBudget
    };

    const vehicleIds = vehicles.map(v => v.vehicle_id);
    await db.query(
      'INSERT INTO RECOMMENDATION_LOG (user_id, recommended_vehicle_ids, filters_applied) VALUES (?, ?, ?)',
      [userId, JSON.stringify(vehicleIds), JSON.stringify(appliedFilters)]
    );

    return {
      type: 'vehicle_list',
      content: `Here are all ${vehicleType}s${savedBudget ? ` within ₹${savedBudget/100000}L budget` : ''} (${vehicles.length} vehicles):`,
      vehicles: vehicles,
      quick_actions: [
        { label: 'Change Budget', action: 'set_budget' },
        { label: 'Add Filters', action: 'refine' },
        { label: 'Compare These', action: 'compare' }
      ]
    };
  }

  // Handle refine/add filters
  if (lowerMessage.includes('refine') || lowerMessage.includes('add filters') || lowerMessage.includes('filter')) {
    const [recentRecommendations] = await db.query(
      `SELECT filters_applied FROM RECOMMENDATION_LOG 
       WHERE user_id = ? 
       ORDER BY timestamp DESC 
       LIMIT 1`,
      [userId]
    );

    let currentFilters = {};
    if (recentRecommendations.length > 0 && recentRecommendations[0].filters_applied) {
      try {
        currentFilters = typeof recentRecommendations[0].filters_applied === 'string'
          ? JSON.parse(recentRecommendations[0].filters_applied)
          : recentRecommendations[0].filters_applied;
      } catch (error) {
        console.error('Error parsing filters:', error);
      }
    }

    return {
      type: 'text',
      content: `Let's refine your search! Choose additional filters:${currentFilters.vehicle_type ? `\n\nCurrent: ${currentFilters.vehicle_type}` : ''}${currentFilters.budget_max ? ` • Budget: ₹${currentFilters.budget_max/100000}L` : ''}`,
      quick_actions: [
        { label: '⚙️ Transmission', action: 'filter_transmission' },
        { label: '⛽ Fuel Type', action: 'filter_fuel' },
        { label: '🪑 Seating', action: 'filter_seating' },
        { label: '💰 Budget', action: 'set_budget' },
        { label: '🔙 Back to Results', action: currentFilters.vehicle_type ? currentFilters.vehicle_type.toLowerCase() : 'browse_all' }
      ]
    };
  }

  // Handle transmission filter
  if (lowerMessage.includes('filter_transmission')) {
    return {
      type: 'text',
      content: 'What transmission type do you prefer?',
      quick_actions: [
        { label: '🔧 Manual', value: 'apply_filter_manual' },
        { label: '⚙️ Automatic', value: 'apply_filter_automatic' },
        { label: '🔙 Back', action: 'refine' }
      ]
    };
  }

  // Handle fuel type filter
  if (lowerMessage.includes('filter_fuel')) {
    return {
      type: 'text',
      content: 'What fuel type do you prefer?',
      quick_actions: [
        { label: '⛽ Petrol', value: 'apply_filter_petrol' },
        { label: '🛢️ Diesel', value: 'apply_filter_diesel' },
        { label: '🔋 Electric', value: 'apply_filter_electric' },
        { label: '💨 CNG', value: 'apply_filter_cng' },
        { label: '🔙 Back', action: 'refine' }
      ]
    };
  }

  // Handle seating filter
  if (lowerMessage.includes('filter_seating')) {
    return {
      type: 'text',
      content: 'How many seats do you need?',
      quick_actions: [
        { label: '5 Seater', value: 'apply_filter_5_seats' },
        { label: '7 Seater', value: 'apply_filter_7_seats' },
        { label: '8+ Seater', value: 'apply_filter_8_seats' },
        { label: '🔙 Back', action: 'refine' }
      ]
    };
  }

  // Apply filters
  if (lowerMessage === 'apply_filter_manual') {
    return await applyFilterAndSearch(userId, { transmission: 'Manual' });
  }
  if (lowerMessage === 'apply_filter_automatic') {
    return await applyFilterAndSearch(userId, { transmission: 'Automatic' });
  }
  if (lowerMessage === 'apply_filter_petrol') {
    return await applyFilterAndSearch(userId, { fuel_type: 'Petrol' });
  }
  if (lowerMessage === 'apply_filter_diesel') {
    return await applyFilterAndSearch(userId, { fuel_type: 'Diesel' });
  }
  if (lowerMessage === 'apply_filter_electric') {
    return await applyFilterAndSearch(userId, { fuel_type: 'Electric' });
  }
  if (lowerMessage === 'apply_filter_cng') {
    return await applyFilterAndSearch(userId, { fuel_type: 'CNG' });
  }
  if (lowerMessage === 'apply_filter_5_seats') {
    return await applyFilterAndSearch(userId, { seating_capacity: 5 });
  }
  if (lowerMessage === 'apply_filter_7_seats') {
    return await applyFilterAndSearch(userId, { seating_capacity: 7 });
  }
  if (lowerMessage === 'apply_filter_8_seats') {
    return await applyFilterAndSearch(userId, { seating_capacity: 8 });
  }

  // Set budget action
  if (lowerMessage.includes('set budget') || lowerMessage.includes('help me set my budget')) {
    return {
      type: 'text',
      content: 'What\'s your budget range for the vehicle?',
      quick_actions: [
        { label: 'Under 5L', value: 'under 5 lakhs' },
        { label: '5-10L', value: 'between 5 and 10 lakhs' },
        { label: '10-15L', value: 'between 10 and 15 lakhs' },
        { label: '15-20L', value: 'between 15 and 20 lakhs' },
        { label: '20L+', value: 'above 20 lakhs' }
      ]
    };
  }

  // Budget queries
  if (lowerMessage.includes('budget') || lowerMessage.includes('price') || lowerMessage.includes('lakh')) {
    const filters = parseUserQuery(userMessage);
    
    if (filters.budget_max) {
      const [existingPref] = await db.query(
        'SELECT * FROM USER_PREFERENCE WHERE user_id = ?',
        [userId]
      );

      if (existingPref.length > 0) {
        await db.query(
          'UPDATE USER_PREFERENCE SET budget_max = ? WHERE user_id = ?',
          [filters.budget_max, userId]
        );
      } else {
        await db.query(
          'INSERT INTO USER_PREFERENCE (user_id, budget_max) VALUES (?, ?)',
          [userId, filters.budget_max]
        );
      }

      return {
        type: 'text',
        content: `Great! I've saved your budget of ₹${filters.budget_max/100000} lakhs. Now, what type of vehicle are you looking for?`,
        quick_actions: [
          { label: '🚗 Hatchback', value: 'hatchback' },
          { label: '🚙 Sedan', value: 'sedan' },
          { label: '🚐 SUV', value: 'suv' },
          { label: '🚌 MUV', value: 'muv' },
          { label: '🏎️ Show All', action: 'show_all_in_budget' }
        ]
      };
    }

    return {
      type: 'text',
      content: 'What\'s your budget range? For example, you can say "under 10 lakhs" or "between 15-20 lakhs".',
      quick_actions: [
        { label: 'Under 5L', value: 'under 5 lakhs' },
        { label: '5-10L', value: 'between 5 and 10 lakhs' },
        { label: '10-15L', value: 'between 10 and 15 lakhs' },
        { label: '15-20L', value: 'between 15 and 20 lakhs' },
        { label: '20L+', value: 'above 20 lakhs' }
      ]
    };
  }

  // Feature queries
  if (lowerMessage.includes('automatic') || lowerMessage.includes('sunroof') || 
      lowerMessage.includes('safety') || lowerMessage.includes('mileage')) {
    const filters = parseUserQuery(userMessage);
    
    let query = 'SELECT * FROM VEHICLE WHERE availability_status = "Available"';
    const params = [];

    if (filters.transmission) {
      query += ' AND transmission = ?';
      params.push(filters.transmission);
    }

    query += ' ORDER BY price ASC';

    const [vehicles] = await db.query(query, params);

    const vehicleIds = vehicles.map(v => v.vehicle_id);
    await db.query(
      'INSERT INTO RECOMMENDATION_LOG (user_id, recommended_vehicle_ids, filters_applied) VALUES (?, ?, ?)',
      [userId, JSON.stringify(vehicleIds), JSON.stringify(filters)]
    );

    return {
      type: 'vehicle_list',
      content: 'Based on your requirements, here are my recommendations:',
      vehicles: vehicles,
      quick_actions: [
        { label: 'Compare These', action: 'compare' },
        { label: 'Refine Search', action: 'refine' },
        { label: 'Browse All', action: 'browse_all' }
      ]
    };
  }

  // Default response
  return {
    type: 'text',
    content: 'I can help you find the perfect vehicle! You can tell me:\n• Your budget (e.g., "under 10 lakhs")\n• Vehicle type (SUV, Sedan, Hatchback)\n• Features you need (automatic, sunroof, etc.)\n• Or simply say "show me cars"',
    quick_actions: [
      { label: 'Set Budget', action: 'set_budget' },
      { label: 'Choose Type', action: 'choose_type' },
      { label: 'Browse All', action: 'browse_all' }
    ]
  };
}

// Helper function to apply filters and search
async function applyFilterAndSearch(userId, newFilter) {
  const [recentRecommendations] = await db.query(
    `SELECT filters_applied FROM RECOMMENDATION_LOG 
     WHERE user_id = ? 
     ORDER BY timestamp DESC 
     LIMIT 1`,
    [userId]
  );

  let previousFilters = {};
  if (recentRecommendations.length > 0 && recentRecommendations[0].filters_applied) {
    try {
      previousFilters = typeof recentRecommendations[0].filters_applied === 'string'
        ? JSON.parse(recentRecommendations[0].filters_applied)
        : recentRecommendations[0].filters_applied;
    } catch (error) {
      console.error('Error parsing previous filters:', error);
    }
  }

  const [userPreferences] = await db.query(
    'SELECT budget_max FROM USER_PREFERENCE WHERE user_id = ?',
    [userId]
  );

  if (userPreferences.length > 0 && userPreferences[0].budget_max) {
    previousFilters.budget_max = userPreferences[0].budget_max;
  }

  const combinedFilters = { ...previousFilters, ...newFilter };

  let query = 'SELECT * FROM VEHICLE WHERE availability_status = "Available"';
  const params = [];

  if (combinedFilters.vehicle_type) {
    query += ' AND vehicle_type = ?';
    params.push(combinedFilters.vehicle_type);
  }
  if (combinedFilters.budget_max) {
    query += ' AND price <= ?';
    params.push(combinedFilters.budget_max);
  }
  if (combinedFilters.transmission) {
    query += ' AND transmission = ?';
    params.push(combinedFilters.transmission);
  }
  if (combinedFilters.fuel_type) {
    query += ' AND fuel_type = ?';
    params.push(combinedFilters.fuel_type);
  }
  if (combinedFilters.seating_capacity) {
    query += ' AND seating_capacity >= ?';
    params.push(combinedFilters.seating_capacity);
  }

  query += ' ORDER BY price ASC';

  const [vehicles] = await db.query(query, params);

  if (vehicles.length === 0) {
    return {
      type: 'text',
      content: 'No vehicles match all your filters. Try removing some filters or changing your criteria.',
      quick_actions: [
        { label: 'Remove Filters', action: 'browse_all' },
        { label: 'Change Budget', action: 'set_budget' },
        { label: 'Try Different Type', action: 'choose_type' }
      ]
    };
  }

  const vehicleIds = vehicles.map(v => v.vehicle_id);
  await db.query(
    'INSERT INTO RECOMMENDATION_LOG (user_id, recommended_vehicle_ids, filters_applied) VALUES (?, ?, ?)',
    [userId, JSON.stringify(vehicleIds), JSON.stringify(combinedFilters)]
  );

  let filterDesc = [];
  if (combinedFilters.vehicle_type) filterDesc.push(combinedFilters.vehicle_type);
  if (combinedFilters.transmission) filterDesc.push(combinedFilters.transmission);
  if (combinedFilters.fuel_type) filterDesc.push(combinedFilters.fuel_type);
  if (combinedFilters.seating_capacity) filterDesc.push(`${combinedFilters.seating_capacity}+ seats`);
  if (combinedFilters.budget_max) filterDesc.push(`₹${combinedFilters.budget_max/100000}L`);

  return {
    type: 'vehicle_list',
    content: `Found ${vehicles.length} vehicle(s) matching: ${filterDesc.join(', ')}`,
    vehicles: vehicles,
    quick_actions: [
      { label: 'Add More Filters', action: 'refine' },
      { label: 'Compare These', action: 'compare' },
      { label: 'Clear Filters', action: 'browse_all' }
    ]
  };
}

module.exports = router;