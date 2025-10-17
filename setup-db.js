const mysql = require('mysql2/promise');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function setupDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });

  try {
    console.log('Creating database...');
    await connection.query('CREATE DATABASE IF NOT EXISTS vehicle_chatbot_db');
    console.log('✓ Database created/verified');

    console.log('Using database...');
    await connection.query('USE vehicle_chatbot_db');

    console.log('Reading schema file...');
    // Update this path to point to database/schema.sql
    const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
    
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`schema.sql not found at ${schemaPath}`);
    }

    const sql = fs.readFileSync(schemaPath, 'utf8');
    const statements = sql.split(';').filter(stmt => stmt.trim());
    
    console.log(`Executing ${statements.length} SQL statements...`);
    
    for (const statement of statements) {
      if (statement.trim()) {
        await connection.query(statement);
      }
    }

    console.log('✓ All tables created successfully');
    console.log('✓ Sample data inserted');
    console.log('\n✅ Database setup complete!\n');

  } catch (error) {
    console.error('Database setup error:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

setupDatabase();