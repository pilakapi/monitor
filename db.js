/**
 * M3U Monitor Proxy - Módulo de Base de Datos
 * Conexión a Neon PostgreSQL para persistencia de datos
 */

const { Pool } = require('pg');

// Crear pool de conexión usando la variable de entorno DATABASE_URL
// En Render, esta variable se configura en el dashboard
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necesario para Neon en modo gratuito
  }
});

/**
 * Inicializar la base de datos creando las tablas necesarias
 */
async function initializeDatabase() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      cedula VARCHAR(50) NOT NULL,
      phone VARCHAR(50) NOT NULL,
      original_url TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_access TIMESTAMP,
      last_device VARCHAR(50),
      access_logs JSONB DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);
    CREATE INDEX IF NOT EXISTS idx_users_cedula ON users(cedula);
  `;

  try {
    await pool.query(createTableQuery);
    console.log('✅ Base de datos inicializada correctamente');
  } catch (error) {
    console.error('❌ Error al inicializar la base de datos:', error.message);
    throw error;
  }
}

/**
 * Obtener todos los usuarios (con filtro opcional por nombre y conteo de conexiones activas)
 */
async function getUsers(searchName = null) {
  try {
    let query = 'SELECT * FROM users';
    let params = [];

    if (searchName) {
      query += ' WHERE name ILIKE $1';
      params = [`%${searchName}%`];
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);

    // Calcular conexiones activas para cada usuario
    const usersWithConnections = result.rows.map(user => {
      user.active_connections = calculateActiveConnections(user.access_logs);
      return user;
    });

    return usersWithConnections;
  } catch (error) {
    console.error('❌ Error al obtener usuarios:', error.message);
    throw error;
  }
}

/**
 * Obtener un usuario por su ID (con conteo de conexiones activas)
 */
async function getUserById(id) {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    const user = result.rows[0];

    if (user) {
      // Calcular conexiones activas en los últimos 30 minutos
      user.active_connections = calculateActiveConnections(user.access_logs);
    }

    return user;
  } catch (error) {
    console.error('❌ Error al obtener usuario:', error.message);
    throw error;
  }
}

/**
 * Calcular el número de conexiones activas en los últimos 30 minutos
 * Cuenta IPs únicos que han accedido en el período de tiempo
 */
function calculateActiveConnections(accessLogs) {
  if (!accessLogs || !Array.isArray(accessLogs)) {
    return 0;
  }

  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

  // Filtrar accesos en los últimos 30 minutos
  const recentLogs = accessLogs.filter(log => {
    const logDate = new Date(log.date);
    return logDate >= thirtyMinutesAgo;
  });

  // Obtener IPs únicos
  const uniqueIps = new Set(recentLogs.map(log => log.ip));

  return uniqueIps.size;
}

/**
 * Crear un nuevo usuario
 */
async function createUser(user) {
  const { id, name, cedula, phone, original_url } = user;

  try {
    const result = await pool.query(
      `INSERT INTO users (id, name, cedula, phone, original_url, created_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       RETURNING *`,
      [id, name, cedula, phone, original_url]
    );
    return result.rows[0];
  } catch (error) {
    console.error('❌ Error al crear usuario:', error.message);
    throw error;
  }
}

/**
 * Actualizar un usuario existente
 * El ID no se puede cambiar - mantiene la URL espejo constante
 */
async function updateUser(id, updates) {
  const { name, cedula, phone, original_url } = updates;

  try {
    const result = await pool.query(
      `UPDATE users
       SET name = $1, cedula = $2, phone = $3, original_url = $4
       WHERE id = $5
       RETURNING *`,
      [name, cedula, phone, original_url, id]
    );
    return result.rows[0];
  } catch (error) {
    console.error('❌ Error al actualizar usuario:', error.message);
    throw error;
  }
}

/**
 * Eliminar un usuario
 */
async function deleteUser(id) {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    return true;
  } catch (error) {
    console.error('❌ Error al eliminar usuario:', error.message);
    throw error;
  }
}

/**
 * Registrar acceso del dispositivo y actualizar información
 */
async function logAccess(id, deviceInfo) {
  const { device, ip } = deviceInfo;

  try {
    // Obtener el usuario actual para agregar al log
    const user = await getUserById(id);
    if (!user) return null;

    // Crear nuevo registro de acceso
    const newLog = {
      date: new Date().toISOString(),
      device: device,
      ip: ip
    };

    // Agregar al historial de accesos
    const accessLogs = user.access_logs || [];
    accessLogs.push(newLog);

    // Mantener solo los últimos 100 accesos
    const trimmedLogs = accessLogs.slice(-100);

    // Actualizar usuario con último acceso
    const result = await pool.query(
      `UPDATE users
       SET last_access = CURRENT_TIMESTAMP,
           last_device = $1,
           access_logs = $2
       WHERE id = $3
       RETURNING *`,
      [device, JSON.stringify(trimmedLogs), id]
    );

    return result.rows[0];
  } catch (error) {
    console.error('❌ Error al registrar acceso:', error.message);
    throw error;
  }
}

/**
 * Cerrar el pool de conexiones
 */
async function closePool() {
  await pool.end();
  console.log('🔌 Conexiones de base de datos cerradas');
}

module.exports = {
  pool,
  initializeDatabase,
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  logAccess,
  closePool
};
