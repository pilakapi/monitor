/**
 * M3U Sentinel - Conexión a Base de Datos Neon PostgreSQL
 *
 * Este módulo maneja la conexión a la base de datos Neon
 * y crea las tablas necesarias para el funcionamiento de la aplicación.
 */

const { Pool } = require('pg');
require('dotenv').config();

// Configuración del pool de conexiones
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Necesario para Neon en Render
  }
});

/**
 * Inicializa las tablas de la base de datos
 * Se ejecuta al iniciar el servidor
 */
async function initDatabase() {
  try {
    // Tabla de playlists/listas M3U
    await pool.query(`
      CREATE TABLE IF NOT EXISTS playlists (
        id SERIAL PRIMARY KEY,
        mirror_id VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        identity_num VARCHAR(50),
        phone VARCHAR(50),
        original_url TEXT NOT NULL,
        max_devices INTEGER DEFAULT 3 CHECK (max_devices >= 1 AND max_devices <= 10),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✓ Tabla playlists verificada/creada');

    // Tabla de registros de acceso
    await pool.query(`
      CREATE TABLE IF NOT EXISTS access_logs (
        id SERIAL PRIMARY KEY,
        playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
        ip_address VARCHAR(45) NOT NULL,
        user_agent TEXT,
        accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✓ Tabla access_logs verificada/creada');

    // Crear índice para优化的 búsquedas
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_access_logs_playlist_time
      ON access_logs(playlist_id, accessed_at)
    `);

    console.log('✓ Índices verificados/creados');

    return true;
  } catch (error) {
    console.error('✗ Error al inicializar la base de datos:', error.message);
    throw error;
  }
}

/**
 * Obtiene todas las playlists con información de dispositivos activos
 */
async function getAllPlaylists() {
  const query = `
    SELECT
      p.*,
      COUNT(DISTINCT CASE
        WHEN a.accessed_at > NOW() - INTERVAL '15 minutes'
        THEN a.ip_address
      END) as active_devices
    FROM playlists p
    LEFT JOIN access_logs a ON p.id = a.playlist_id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `;

  const result = await pool.query(query);
  return result.rows;
}

/**
 * Busca playlists por nombre
 */
async function searchPlaylists(searchTerm) {
  const query = `
    SELECT
      p.*,
      COUNT(DISTINCT CASE
        WHEN a.accessed_at > NOW() - INTERVAL '15 minutes'
        THEN a.ip_address
      END) as active_devices
    FROM playlists p
    LEFT JOIN access_logs a ON p.id = a.playlist_id
    WHERE p.name ILIKE $1
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `;

  const result = await pool.query(query, [`%${searchTerm}%`]);
  return result.rows;
}

/**
 * Obtiene una playlist por su ID único (mirror_id)
 */
async function getPlaylistByMirrorId(mirrorId) {
  const query = `
    SELECT
      p.*,
      COUNT(DISTINCT CASE
        WHEN a.accessed_at > NOW() - INTERVAL '15 minutes'
        THEN a.ip_address
      END) as active_devices
    FROM playlists p
    LEFT JOIN access_logs a ON p.id = a.playlist_id
    WHERE p.mirror_id = $1
    GROUP BY p.id
  `;

  const result = await pool.query(query, [mirrorId]);
  return result.rows[0];
}

/**
 * Crea una nueva playlist
 */
async function createPlaylist(data) {
  const { name, identity_num, phone, original_url, max_devices, mirror_id } = data;

  const query = `
    INSERT INTO playlists (name, identity_num, phone, original_url, max_devices, mirror_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;

  const values = [name, identity_num, phone, original_url, max_devices, mirror_id];
  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Actualiza una playlist existente
 */
async function updatePlaylist(id, data) {
  const { name, identity_num, phone, original_url, max_devices } = data;

  const query = `
    UPDATE playlists
    SET name = $1, identity_num = $2, phone = $3, original_url = $4, max_devices = $5, updated_at = CURRENT_TIMESTAMP
    WHERE id = $6
    RETURNING *
  `;

  const values = [name, identity_num, phone, original_url, max_devices, id];
  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Elimina una playlist
 */
async function deletePlaylist(id) {
  const query = 'DELETE FROM playlists WHERE id = $1 RETURNING *';
  const result = await pool.query(query, [id]);
  return result.rows[0];
}

/**
 * Registra un acceso a la playlist
 */
async function logAccess(playlistId, ipAddress, userAgent) {
  const query = `
    INSERT INTO access_logs (playlist_id, ip_address, user_agent)
    VALUES ($1, $2, $3)
  `;

  await pool.query(query, [playlistId, ipAddress, userAgent]);
}

/**
 * Obtiene la analítica de dispositivos conectados
 */
async function getDeviceAnalytics(playlistId) {
  // Dispositivos activos en los últimos 15 minutos
  const activeQuery = `
    SELECT COUNT(DISTINCT ip_address) as active_count
    FROM access_logs
    WHERE playlist_id = $1
    AND accessed_at > NOW() - INTERVAL '15 minutes'
  `;

  // Total de accesos en las últimas 24 horas
  const totalQuery = `
    SELECT COUNT(*) as total_accesses
    FROM access_logs
    WHERE playlist_id = $1
    AND accessed_at > NOW() - INTERVAL '24 hours'
  `;

  // Historial de IPs únicas
  const uniqueQuery = `
    SELECT DISTINCT ip_address, MAX(accessed_at) as last_access
    FROM access_logs
    WHERE playlist_id = $1
    AND accessed_at > NOW() - INTERVAL '24 hours'
    GROUP BY ip_address
    ORDER BY last_access DESC
  `;

  const [active, total, unique] = await Promise.all([
    pool.query(activeQuery, [playlistId]),
    pool.query(totalQuery, [playlistId]),
    pool.query(uniqueQuery, [playlistId])
  ]);

  return {
    active_devices: parseInt(active.rows[0]?.active_count || 0),
    total_accesses: parseInt(total.rows[0]?.total_accesses || 0),
    unique_ips: unique.rows
  };
}

module.exports = {
  pool,
  initDatabase,
  getAllPlaylists,
  searchPlaylists,
  getPlaylistByMirrorId,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  logAccess,
  getDeviceAnalytics
};
