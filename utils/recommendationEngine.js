function scoreVehicle(vehicle, preferences) {
  let score = 0;

  // Budget scoring
  if (preferences.budget_max) {
    const priceRatio = vehicle.price / preferences.budget_max;
    if (priceRatio <= 0.8) {
      score += 10; // Good value
    } else if (priceRatio <= 1.0) {
      score += 5;
    }
  }

  // Fuel efficiency for city driving
  if (preferences.primary_use_case === 'city driving' && vehicle.mileage > 18) {
    score += 8;
  }

  // Seating capacity match
  if (preferences.seating_needed && vehicle.seating_capacity >= preferences.seating_needed) {
    score += 10;
  }

  // Feature matching
  if (preferences.must_have_features && vehicle.features) {
    const vehicleFeatures = vehicle.features;
    const mustHaveFeatures = preferences.must_have_features;
    
    const matchedFeatures = mustHaveFeatures.filter(feature => 
      vehicleFeatures.includes(feature)
    );
    
    score += matchedFeatures.length * 5;
  }

  // Safety rating bonus
  if (vehicle.safety_rating >= 4.5) {
    score += 7;
  } else if (vehicle.safety_rating >= 4.0) {
    score += 3;
  }

  // Recent model year
  if (vehicle.year >= 2023) {
    score += 5;
  }

  return score;
}

function parseUserQuery(query) {
  const lowerQuery = query.toLowerCase();
  const filters = {};

  // Extract budget
  const budgetMatch = lowerQuery.match(/(\d+)\s*(lakh|lakhs|l)/i);
  if (budgetMatch) {
    filters.budget_max = parseFloat(budgetMatch[1]) * 100000;
  }

  const underBudgetMatch = lowerQuery.match(/under\s+(\d+)\s*(lakh|lakhs|l)/i);
  if (underBudgetMatch) {
    filters.budget_max = parseFloat(underBudgetMatch[1]) * 100000;
  }

  // Extract vehicle type
  if (lowerQuery.includes('suv')) filters.vehicle_type = 'SUV';
  if (lowerQuery.includes('sedan')) filters.vehicle_type = 'Sedan';
  if (lowerQuery.includes('hatchback')) filters.vehicle_type = 'Hatchback';
  if (lowerQuery.includes('muv')) filters.vehicle_type = 'MUV';

  // Extract fuel type
  if (lowerQuery.includes('petrol')) filters.fuel_type = 'Petrol';
  if (lowerQuery.includes('diesel')) filters.fuel_type = 'Diesel';
  if (lowerQuery.includes('electric')) filters.fuel_type = 'Electric';
  if (lowerQuery.includes('cng')) filters.fuel_type = 'CNG';

  // Extract transmission
  if (lowerQuery.includes('automatic') || lowerQuery.includes('auto')) {
    filters.transmission = 'Automatic';
  }
  if (lowerQuery.includes('manual')) filters.transmission = 'Manual';

  // Extract use case
  if (lowerQuery.includes('family')) {
    filters.seating_needed = 7;
    filters.primary_use_case = 'family';
  }
  if (lowerQuery.includes('city')) filters.primary_use_case = 'city driving';

  // Extract features
  const features = [];
  if (lowerQuery.includes('sunroof')) features.push('Sunroof');
  if (lowerQuery.includes('airbag')) features.push('Airbags');
  if (lowerQuery.includes('abs')) features.push('ABS');
  if (lowerQuery.includes('cruise control')) features.push('Cruise Control');
  
  if (features.length > 0) {
    filters.must_have_features = features;
  }

  // Extract brand
  const brands = ['maruti', 'hyundai', 'tata', 'honda', 'mahindra', 'toyota', 'kia', 'mg'];
  for (const brand of brands) {
    if (lowerQuery.includes(brand)) {
      filters.make = brand.charAt(0).toUpperCase() + brand.slice(1);
      break;
    }
  }

  return filters;
}

module.exports = { scoreVehicle, parseUserQuery };
