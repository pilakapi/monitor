// Configuración de base de datos PostgreSQL para Neon
// Requiere: DATABASE_URL en variables de entorno

require('dotenv').config();

const { Pool } = require('pg');

// Configuración del pool de conexiones
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necesario para Neon
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

// Manejo de errores de conexión
pool.on('error', (err, client) => {
  console.error('Error inesperado en el pool de conexiones:', err);
});

// Función para inicializar las tablas si no existen
async function initDatabase() {
  const client = await pool.connect();
  
  try {
    // Crear tabla de usuarios
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(10) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        cedula VARCHAR(50),
        phone VARCHAR(50),
        original_url TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Crear tabla de logs de acceso
    await client.query(`
      CREATE TABLE IF NOT EXISTS access_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        ip_address VARCHAR(45),
        user_agent TEXT,
        accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Crear índices para mejor rendimiento
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_logs_user_id 
      ON access_logs(user_id)
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_access_logs_accessed_at 
      ON access_logs(accessed_at)
    `);

    console.log('✅ Base de datos inicializada correctamente');
  } catch (error) {
    console.error('❌ Error al inicializar la base de datos:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Función para obtener un usuario por ID
async function getUserById(id) {
  const result = await pool.query(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0];
}

// Función para obtener un usuario por slug
async function getUserBySlug(slug) {
  const result = await pool.query(
    'SELECT * FROM users WHERE slug = $1',
    [slug]
  );
  return result.rows[0];
}

// Función para crear un nuevo usuario
async function createUser(userData) {
  const { slug, name, cedula, phone, original_url } = userData;
  
  const result = await pool.query(
    `INSERT INTO users (slug, name, cedula, phone, original_url) 
     VALUES ($1, $2, $3, $4, $5) 
     RETURNING *`,
    [slug, name, cedula, phone, original_url]
  );
  
  return result.rows[0];
}

// Función para actualizar un usuario
async function updateUser(id, userData) {
  const { name, cedula, phone, original_url } = userData;
  
  const result = await pool.query(
    `UPDATE users 
     SET name = $1, cedula = $2, phone = $3, original_url = $4 
     WHERE id = $5 
     RETURNING *`,
    [name, cedula, phone, original_url, id]
  );
  
  return result.rows[0];
}

// Función para eliminar un usuario
async function deleteUser(id) {
  const result = await pool.query(
    'DELETE FROM users WHERE id = $1 RETURNING *',
    [id]
  );
  return result.rows[0];
}

// Función para obtener todos los usuarios con conteo de dispositivos
async function getAllUsers() {
  const result = await pool.query(`
    SELECT 
      u.*,
      COUNT(DISTINCT a.ip_address) as active_devices
    FROM users u
    LEFT JOIN access_logs a ON u.id = a.user_id 
      AND a.accessed_at > NOW() - INTERVAL '5 minutes'
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `);
  
  return result.rows;
}

// Función para buscar usuarios por nombre
async function searchUsers(searchTerm) {
  const result = await pool.query(`
    SELECT 
      u.*,
      COUNT(DISTINCT a.ip_address) as active_devices
    FROM users u
    LEFT JOIN access_logs a ON u.id = a.user_id 
      AND a.accessed_at > NOW() - INTERVAL '5 minutes'
    WHERE u.name ILIKE $1
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `, [`%${searchTerm}%`]);
  
  return result.rows;
}

// Función para registrar un acceso
async function logAccess(userId, ipAddress, userAgent) {
  const result = await pool.query(
    `INSERT INTO access_logs (user_id, ip_address, user_agent) 
     VALUES ($1, $2, $3) 
     RETURNING *`,
    [userId, ipAddress, userAgent]
  );
  return result.rows[0];
}

// Función para obtener el conteo de dispositivos activos
async function getActiveDevices(userId) {
  const result = await pool.query(`
    SELECT COUNT(DISTINCT ip_address) as count
    FROM access_logs
    WHERE user_id = $1 
    AND accessed_at > NOW() - INTERVAL '5 minutes'
  `, [userId]);
  
  return parseInt(result.rows[0].count) || 0;
}

// Verificar si existe un slug
async function slugExists(slug) {
  const result = await pool.query(
    'SELECT id FROM users WHERE slug = $1',
    [slug]
  );
  return result.rows.length > 0;
}

module.exports = {
  pool,
  initDatabase,
  getUserById,
  getUserBySlug,
  createUser,
  updateUser,
  deleteUser,
  getAllUsers,
  searchUsers,
  logAccess,
  getActiveDevices,
  slugExists
};
