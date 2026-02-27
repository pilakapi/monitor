/**
 * M3U Sentinel - Servidor Principal
 *
 * Aplicación de monitoreo de listas M3U con límites de dispositivos
 * y generación de URLs espejo para IPTV
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de PIN de acceso
const ADMIN_PIN = '198823';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Servir archivos estáticos
app.use(express.static(path.join(__dirname)));

// ============================================
// RUTAS DE AUTENTICACIÓN
// ============================================

/**
 * POST /api/login
 * Autenticación con PIN de 6 dígitos
 */
app.post('/api/login', (req, res) => {
  const { pin } = req.body;

  if (!pin) {
    return res.status(400).json({ success: false, message: 'PIN requerido' });
  }

  if (pin === ADMIN_PIN) {
    // Generar token simple (en producción usar JWT)
    const token = Buffer.from(`${ADMIN_PIN}:${Date.now()}`).toString('base64');
    return res.json({
      success: true,
      token: token,
      message: 'Autenticación exitosa'
    });
  }

  return res.status(401).json({ success: false, message: 'PIN incorrecto' });
});

// Middleware de autenticación
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'No autorizado' });
  }

  try {
    const token = authHeader.replace('Bearer ', '');
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [pin, timestamp] = decoded.split(':');

    if (pin !== ADMIN_PIN) {
      return res.status(401).json({ success: false, message: 'Token inválido' });
    }

    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token inválido' });
  }
}

// ============================================
// RUTAS DE PLAYLISTS
// ============================================

/**
 * GET /api/playlists
 * Obtiene todas las playlists con información de dispositivos
 */
app.get('/api/playlists', requireAuth, async (req, res) => {
  try {
    const playlists = await db.getAllPlaylists();
    res.json({ success: true, data: playlists });
  } catch (error) {
    console.error('Error al obtener playlists:', error);
    res.status(500).json({ success: false, message: 'Error al obtener playlists' });
  }
});

/**
 * GET /api/playlists/search?q=termino
 * Busca playlists por nombre
 */
app.get('/api/playlists/search', requireAuth, async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.json({ success: true, data: [] });
    }

    const playlists = await db.searchPlaylists(q);
    res.json({ success: true, data: playlists });
  } catch (error) {
    console.error('Error al buscar playlists:', error);
    res.status(500).json({ success: false, message: 'Error al buscar playlists' });
  }
});

/**
 * GET /api/playlists/:id
 * Obtiene una playlist específica con analítica
 */
app.get('/api/playlists/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const playlists = await db.getAllPlaylists();
    const playlist = playlists.find(p => p.id === parseInt(id));

    if (!playlist) {
      return res.status(404).json({ success: false, message: 'Playlist no encontrada' });
    }

    const analytics = await db.getDeviceAnalytics(id);

    res.json({
      success: true,
      data: { ...playlist, analytics }
    });
  } catch (error) {
    console.error('Error al obtener playlist:', error);
    res.status(500).json({ success: false, message: 'Error al obtener playlist' });
  }
});

/**
 * POST /api/playlists
 * Crea una nueva playlist
 */
app.post('/api/playlists', requireAuth, async (req, res) => {
  try {
    const { name, identity_num, phone, original_url, max_devices } = req.body;

    // Validaciones
    if (!name || !original_url) {
      return res.status(400).json({
        success: false,
        message: 'Nombre y URL original son requeridos'
      });
    }

    if (!original_url.startsWith('http://') && !original_url.startsWith('https://')) {
      return res.status(400).json({
        success: false,
        message: 'La URL debe comenzar con http:// o https://'
      });
    }

    // Generar mirror_id único de 8 caracteres
    const mirrorId = crypto.randomBytes(4).toString('hex');

    const playlist = await db.createPlaylist({
      name,
      identity_num: identity_num || '',
      phone: phone || '',
      original_url,
      max_devices: max_devices || 3,
      mirror_id: mirrorId
    });

    res.json({ success: true, data: playlist });
  } catch (error) {
    console.error('Error al crear playlist:', error);
    res.status(500).json({ success: false, message: 'Error al crear playlist' });
  }
});

/**
 * PUT /api/playlists/:id
 * Actualiza una playlist existente
 */
app.put('/api/playlists/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, identity_num, phone, original_url, max_devices } = req.body;

    // Validaciones
    if (!name || !original_url) {
      return res.status(400).json({
        success: false,
        message: 'Nombre y URL original son requeridos'
      });
    }

    if (!original_url.startsWith('http://') && !original_url.startsWith('https://')) {
      return res.status(400).json({
        success: false,
        message: 'La URL debe comenzar con http:// o https://'
      });
    }

    const playlist = await db.updatePlaylist(id, {
      name,
      identity_num: identity_num || '',
      phone: phone || '',
      original_url,
      max_devices: max_devices || 3
    });

    if (!playlist) {
      return res.status(404).json({ success: false, message: 'Playlist no encontrada' });
    }

    res.json({ success: true, data: playlist });
  } catch (error) {
    console.error('Error al actualizar playlist:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar playlist' });
  }
});

/**
 * DELETE /api/playlists/:id
 * Elimina una playlist
 */
app.delete('/api/playlists/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const playlist = await db.deletePlaylist(id);

    if (!playlist) {
      return res.status(404).json({ success: false, message: 'Playlist no encontrada' });
    }

    res.json({ success: true, data: playlist });
  } catch (error) {
    console.error('Error al eliminar playlist:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar playlist' });
  }
});

/**
 * GET /api/playlists/:id/analytics
 * Obtiene analítica de dispositivos de una playlist
 */
app.get('/api/playlists/:id/analytics', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const analytics = await db.getDeviceAnalytics(id);
    res.json({ success: true, data: analytics });
  } catch (error) {
    console.error('Error al obtener analítica:', error);
    res.status(500).json({ success: false, message: 'Error al obtener analítica' });
  }
});

// ============================================
// RUTA PROXY M3U (URL ESPEJO)
// ============================================

/**
 * GET /get/:mirror_id.m3u
 * Proxy que limita el acceso por dispositivos
 */
app.get('/get/:mirror_id.m3u', async (req, res) => {
  try {
    const { mirror_id } = req.params;
    const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    console.log(`[M3U Proxy] Solicitud para ${mirror_id} desde IP: ${clientIp}`);

    // Buscar playlist por mirror_id
    const playlist = await db.getPlaylistByMirrorId(mirror_id);

    if (!playlist) {
      console.log(`[M3U Proxy] Playlist no encontrada: ${mirror_id}`);
      return res.status(404).type('application/x-mpegurl')
        .send('#EXTM3U\n#EXTINF:-1,LISTA NO ENCONTRADA\n#EXTINF:-1,Error: Playlist no encontrada o eliminada\n');
    }

    // Verificar límite de dispositivos
    const activeDevices = parseInt(playlist.active_devices || 0);
    const maxDevices = parseInt(playlist.max_devices || 3);

    console.log(`[M3U Proxy] Dispositivos activos: ${activeDevices}/${maxDevices}`);

    if (activeDevices >= maxDevices) {
      console.log(`[M3U Proxy] Límite alcanzado para ${mirror_id}`);
      return res.status(403).type('application/x-mpegurl')
        .send(`#EXTM3U\n#EXTINF:-1,LÍMITE DE DISPOSITIVOS ALCANZADO\n#EXTINF:-1,Error: Máximo de ${maxDevices} dispositivos permitidos. Contacta al administrador.\n`);
    }

    // Registrar el acceso
    await db.logAccess(playlist.id, clientIp, userAgent);

    // Fetch del M3U original
    console.log(`[M3U Proxy] Obteniendo lista original de: ${playlist.original_url}`);

    const response = await axios.get(playlist.original_url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*'
      },
      responseType: 'text'
    });

    // Verificar que es contenido M3U válido
    let m3uContent = response.data;

    if (!m3uContent || typeof m3uContent !== 'string') {
      console.log(`[M3U Proxy] Contenido inválido para ${mirror_id}`);
      return res.status(500).type('application/x-mpegurl')
        .send('#EXTM3U\n#EXTINF:-1,CONTENIDO INVÁLIDO\n#EXTINF:-1,Error: No se pudo obtener la lista M3U\n');
    }

    // Agregar header indicando que es una lista monitorizada
    const monitoredHeader = `#EXTM3U\n# M3U Sentinel - Lista Monitorizada\n# Usuario: ${playlist.name}\n# ID: ${playlist.mirror_id}\n`;

    // Si el contenido ya empieza con #EXTM3U, lo prependemos
    if (m3uContent.startsWith('#EXTM3U')) {
      m3uContent = monitoredHeader + m3uContent.substring(8);
    } else {
      m3uContent = monitoredHeader + m3uContent;
    }

    console.log(`[M3U Proxy] Lista servida exitosamente para ${mirror_id}`);

    // Devolver contenido M3U
    res.type('application/x-mpegurl');
    res.set('Content-Disposition', `attachment; filename="${playlist.name}.m3u"`);
    res.set('X-M3U-Sentinel', 'Monitored');
    res.send(m3uContent);

  } catch (error) {
    console.error('[M3U Proxy] Error:', error.message);

    // En caso de error, devolver un M3U con mensaje de error
    res.type('application/x-mpegurl')
      .send(`#EXTM3U\n#EXTINF:-1,ERROR DE CONEXIÓN\n#EXTINF:-1,Error: ${error.message}\n`);
  }
});

// ============================================
// RUTA DE SALUD DEL SERVIDOR
// ============================================

/**
 * GET /api/health
 * Verifica el estado del servidor y base de datos
 */
app.get('/api/health', async (req, res) => {
  try {
    // Probar conexión a la base de datos
    await db.pool.query('SELECT 1');

    res.json({
      success: true,
      status: 'online',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'error',
      database: 'disconnected',
      error: error.message
    });
  }
});

// ============================================
// INICIO DEL SERVIDOR
// ============================================

async function startServer() {
  try {
    // Inicializar base de datos
    console.log('📡 Conectando a la base de datos Neon...');
    await db.initDatabase();
    console.log('✓ Base de datos inicializada correctamente');

    // Iniciar servidor
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🎯 M3U Sentinel iniciado en puerto ${PORT}`);
      console.log(`   - Panel de control: http://localhost:${PORT}`);
      console.log(`   - API Salud: http://localhost:${PORT}/api/health`);
      console.log(`   - PIN de acceso: ${ADMIN_PIN}`);
      console.log('');
    });
  } catch (error) {
    console.error('✗ Error al iniciar el servidor:', error.message);
    console.log('\n⚠️  Asegúrate de configurar la variable DATABASE_URL');
    console.log('   Ejemplo: postgres://user:pass@host.neon.tech/dbname?sslmode=require');
    process.exit(1);
  }
}

startServer();
