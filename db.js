const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('Configura DATABASE_URL para el control de kits.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000
});

pool.on('error', error => {
  console.error('Conexión PostgreSQL del control de kits:', error.code || error.message);
});

module.exports = pool;
