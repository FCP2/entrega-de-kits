require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const pool = require('../db');

(async () => {
  try {
    const sql = await fs.readFile(path.join(__dirname, '..', 'sql', '001_entregas_kits.sql'), 'utf8');
    await pool.query(sql);
    console.log('Tabla entregas_kits lista. No se modificaron registros ni participantes.');
  } catch (error) {
    console.error('No fue posible preparar entregas_kits:', error.code || error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
