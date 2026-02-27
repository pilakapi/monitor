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

// Tiempo de expiración de dispositivos inactivos (30 minutos)
const DEVICE_EXPIRY_MINUTES = 30;

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

    // Tabla de registros de acceso (historial)
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

    // NUEVA TABLA: Tabla de dispositivos conectados (tracking persistente)
    // ip_address puede ser IP normal (hasta 45 chars) o hash de dispositivo (32 chars para MD5)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS connected_devices (
        id SERIAL PRIMARY KEY,
        playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
        ip_address VARCHAR(64) NOT NULL,
        user_agent TEXT,
        first_connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_heartbeat_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        UNIQUE(playlist_id, ip_address)
      )
    `);

    console.log('✓ Tabla connected_devices verificada/creada');

    // Crear índices para búsquedas optimizadas
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_access_logs_playlist_time
      ON access_logs(playlist_id, accessed_at)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_connected_devices_playlist
      ON connected_devices(playlist_id, is_active)
    `);

    console.log('✓ Índices verificados/creados');

    // Limpiar dispositivos inactivos al iniciar
    await cleanupExpiredDevices();

    return true;
  } catch (error) {
    console.error('✗ Error al inicializar la base de datos:', error.message);
    throw error;
  }
}

/**
 * Limpia dispositivos que han estado inactivos por más de DEVICE_EXPIRY_MINUTES
 */
async function cleanupExpiredDevices() {
  try {
    const query = `
      UPDATE connected_devices
      SET is_active = false
      WHERE is_active = true
      AND last_heartbeat_at < NOW() - INTERVAL '${DEVICE_EXPIRY_MINUTES} minutes'
    `;

    const result = await pool.query(query);
    if (result.rowCount > 0) {
      console.log(`✓ ${result.rowCount} dispositivos inactivos marcados como inactivos`);
    }
  } catch (error) {
    console.error('Error al limpiar dispositivos inactivos:', error.message);
  }
}

/**
 * Obtiene todas las playlists con información de dispositivos activos
 * Usa la tabla connected_devices para tracking persistente
 */
async function getAllPlaylists() {
  // Primero limpiar dispositivos expirados
  await cleanupExpiredDevices();

  const query = `
    SELECT
      p.*,
      COUNT(CASE WHEN d.is_active = true THEN 1 END) as active_devices
    FROM playlists p
    LEFT JOIN connected_devices d ON p.id = d.playlist_id
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
  // Limpiar dispositivos expirados
  await cleanupExpiredDevices();

  const query = `
    SELECT
      p.*,
      COUNT(CASE WHEN d.is_active = true THEN 1 END) as active_devices
    FROM playlists p
    LEFT JOIN connected_devices d ON p.id = d.playlist_id
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
  // Limpiar dispositivos expirados
  await cleanupExpiredDevices();

  const query = `
    SELECT
      p.*,
      COUNT(CASE WHEN d.is_active = true THEN 1 END) as active_devices
    FROM playlists p
    LEFT JOIN connected_devices d ON p.id = d.playlist_id
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
 * Registra un acceso a la playlist (historial)
 */
async function logAccess(playlistId, ipAddress, userAgent) {
  const query = `
    INSERT INTO access_logs (playlist_id, ip_address, user_agent)
    VALUES ($1, $2, $3)
  `;

  await pool.query(query, [playlistId, ipAddress, userAgent]);
}

/**
 * Registra o actualiza un dispositivo conectado
 * Returns: { success: boolean, message: string }
 */
async function registerDevice(playlistId, ipAddress, userAgent) {
  try {
    // Limpiar dispositivos expirados primero
    await cleanupExpiredDevices();

    // Verificar si el dispositivo ya está registrado y activo
    const checkQuery = `
      SELECT id, is_active FROM connected_devices
      WHERE playlist_id = $1 AND ip_address = $2
    `;

    const checkResult = await pool.query(checkQuery, [playlistId, ipAddress]);

    if (checkResult.rows.length > 0) {
      // El dispositivo ya existe, actualizar last_heartbeat y marcar como activo
      const updateQuery = `
        UPDATE connected_devices
        SET last_heartbeat_at = CURRENT_TIMESTAMP,
            is_active = true,
            user_agent = $3
        WHERE playlist_id = $1 AND ip_address = $2
        RETURNING *
      `;

      await pool.query(updateQuery, [playlistId, ipAddress, userAgent]);

      return {
        success: true,
        message: 'Device heartbeat updated',
        isNew: false
      };
    } else {
      // Nuevo dispositivo - insertar
      const insertQuery = `
        INSERT INTO connected_devices (playlist_id, ip_address, user_agent, is_active)
        VALUES ($1, $2, $3, true)
        RETURNING *
      `;

      await pool.query(insertQuery, [playlistId, ipAddress, userAgent]);

      return {
        success: true,
        message: 'New device registered',
        isNew: true
      };
    }
  } catch (error) {
    console.error('Error registering device:', error.message);
    return {
      success: false,
      message: error.message,
      isNew: false
    };
  }
}

/**
 * Obtiene la analítica de dispositivos conectados
 */
async function getDeviceAnalytics(playlistId) {
  // Limpiar dispositivos expirados
  await cleanupExpiredDevices();

  // Dispositivos activos actualmente
  const activeQuery = `
    SELECT COUNT(*) as active_count
    FROM connected_devices
    WHERE playlist_id = $1 AND is_active = true
  `;

  // Total de dispositivos registrados (histórico)
  const totalQuery = `
    SELECT COUNT(*) as total_devices
    FROM connected_devices
    WHERE playlist_id = $1
  `;

  // Lista de dispositivos activos con detalles
  const devicesQuery = `
    SELECT ip_address, user_agent, first_connected_at, last_heartbeat_at, is_active
    FROM connected_devices
    WHERE playlist_id = $1
    ORDER BY last_heartbeat_at DESC
  `;

  // Total de accesos en las últimas 24 horas (de la tabla histórica)
  const accessQuery = `
    SELECT COUNT(*) as total_accesses
    FROM access_logs
    WHERE playlist_id = $1
    AND accessed_at > NOW() - INTERVAL '24 hours'
  `;

  const [active, total, devices, access] = await Promise.all([
    pool.query(activeQuery, [playlistId]),
    pool.query(totalQuery, [playlistId]),
    pool.query(devicesQuery, [playlistId]),
    pool.query(accessQuery, [playlistId])
  ]);

  return {
    active_devices: parseInt(active.rows[0]?.active_count || 0),
    total_registered_devices: parseInt(total.rows[0]?.total_devices || 0),
    total_accesses: parseInt(access.rows[0]?.total_accesses || 0),
    devices: devices.rows
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
  registerDevice,
  getDeviceAnalytics,
  cleanupExpiredDevices
};
