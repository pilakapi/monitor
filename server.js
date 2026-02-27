/**
 * M3U Monitor Proxy - Servidor Principal
 * Express server con proxy M3U para monitoreo de dispositivos
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const useragent = require('express-useragent');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));
app.use(useragent.express());

// Clave PIN de administración
const ADMIN_PIN = '198823';

/**
 * Middleware de autenticación
 */
function authenticate(req, res, next) {
  const pin = req.headers['x-pin'] || req.body.pin;

  if (pin !== ADMIN_PIN) {
    return res.status(401).json({ error: 'PIN incorrecto' });
  }

  next();
}

/**
 * Verificar autenticación (ruta pública)
 */
app.post('/api/verify-pin', async (req, res) => {
  const { pin } = req.body;

  if (pin === ADMIN_PIN) {
    res.json({ success: true, token: ADMIN_PIN });
  } else {
    res.status(401).json({ error: 'PIN incorrecto' });
  }
});

/**
 * Obtener todos los usuarios con filtro opcional por nombre
 */
app.get('/api/users', authenticate, async (req, res) => {
  try {
    const { search } = req.query;
    const users = await db.getUsers(search);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Obtener un usuario específico
 */
app.get('/api/users/:id', authenticate, async (req, res) => {
  try {
    const user = await db.getUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Crear un nuevo usuario
 */
app.post('/api/users', authenticate, async (req, res) => {
  try {
    const { name, cedula, phone, original_url } = req.body;

    // Validar campos requeridos
    if (!name || !cedula || !phone || !original_url) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    // Generar UUID único para la URL espejo
    const id = uuidv4();

    const user = await db.createUser({ id, name, cedula, phone, original_url });
    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Actualizar un usuario existente
 */
app.put('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { name, cedula, phone, original_url } = req.body;

    // Validar campos requeridos
    if (!name || !cedula || !phone || !original_url) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    // Verificar que el usuario existe
    const existingUser = await db.getUserById(req.params.id);
    if (!existingUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Actualizar usuario (el ID no cambia - URL espejo permanece igual)
    const user = await db.updateUser(req.params.id, {
      name,
      cedula,
      phone,
      original_url
    });

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Eliminar un usuario
 */
app.delete('/api/users/:id', authenticate, async (req, res) => {
  try {
    const existingUser = await db.getUserById(req.params.id);
    if (!existingUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    await db.deleteUser(req.params.id);
    res.json({ success: true, message: 'Usuario eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Ruta proxy M3U - Intercepta el tráfico y detecta dispositivos
 * Formato: /m3u/:id.m3u
 */
app.get('/m3u/:id.m3u', async (req, res) => {
  try {
    const userId = req.params.id;
    const ua = req.headers['user-agent'] || '';
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';

    // Obtener información del usuario
    const user = await db.getUserById(userId);

    if (!user) {
      return res.status(404).send('# ERROR: Playlist no encontrada');
    }

    // Detectar tipo de dispositivo basándose en User-Agent
    let deviceType = 'PC';
    let deviceName = 'Computadora';

    // Detección de TV/Smart TV
    if (/smart-tv|smarttv|googletv|appletv|roku|chromecast|firetv|webos|netcast|tizen|hbbtv/i.test(ua)) {
      deviceType = 'TV';
      if (/webos|lg/i.test(ua)) deviceName = 'LG Smart TV';
      else if (/tizen|samsung/i.test(ua)) deviceName = 'Samsung Smart TV';
      else if (/roku/i.test(ua)) deviceName = 'Roku';
      else if (/firetv|amazon/i.test(ua)) deviceName = 'Amazon Fire TV';
      else if (/appletv|apple/i.test(ua)) deviceName = 'Apple TV';
      else if (/chromecast/i.test(ua)) deviceName = 'Chromecast';
      else deviceName = 'Smart TV';
    }
    // Detección de tablets
    else if (/tablet|ipad|playbook|silk/i.test(ua) || (req.useragent && req.useragent.isTablet)) {
      deviceType = 'Tablet';
      if (/ipad/i.test(ua)) deviceName = 'iPad';
      else if (/android/i.test(ua)) deviceName = 'Android Tablet';
      else deviceName = 'Tablet';
    }
    // Detección de móviles
    else if (/mobile|iphone|ipod|android|blackberry|windows phone/i.test(ua) || (req.useragent && req.useragent.isMobile)) {
      deviceType = 'Móvil';
      if (/iphone|ipad/i.test(ua)) deviceName = 'iPhone/iPad';
      else if (/android/i.test(ua)) deviceName = 'Android';
      else deviceName = 'Móvil';
    }
    // PC
    else {
      if (/windows/i.test(ua)) deviceName = 'Windows PC';
      else if (/mac/i.test(ua)) deviceName = 'Mac';
      else if (/linux/i.test(ua)) deviceName = 'Linux';
      deviceName += ` (${ua.substring(0, 50)})`;
    }

    // Registrar acceso en la base de datos
    await db.logAccess(userId, {
      device: deviceName,
      ip: clientIp
    });

    console.log(`📱 Acceso detectado - Usuario: ${user.name}, Dispositivo: ${deviceName}, IP: ${clientIp}`);

    // Obtener el contenido de la URL M3U original
    try {
      const response = await axios.get(user.original_url, {
        timeout: 30000,
        responseType: 'text',
        headers: {
          'User-Agent': ua || 'M3U Monitor Proxy/1.0'
        }
      });

      // Configurar headers de respuesta
      res.setHeader('Content-Type', 'application/x-mpegurl');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

      // Enviar el contenido M3U
      res.send(response.data);
    } catch (fetchError) {
      console.error('❌ Error al obtener la playlist M3U:', fetchError.message);
      res.status(502).send('# ERROR: No se pudo obtener la playlist original');
    }
  } catch (error) {
    console.error('❌ Error en proxy M3U:', error.message);
    res.status(500).send('# ERROR: Error interno del servidor');
  }
});

/**
 * Obtener URL base para generar enlaces espejo
 */
function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

/**
 * Endpoint para obtener la URL base (para el frontend)
 */
app.get('/api/base-url', (req, res) => {
  res.json({ baseUrl: getBaseUrl(req) });
});

/**
 * Ruta Catch-all - Servir el index.html
 */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Inicializar base de datos yiciar servidor
async function startServer() {
  try {
    // Inicializar la base de datos
    await db.initializeDatabase();

    // Iniciar servidor
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
      console.log(`🔐 PIN de administrador: ${ADMIN_PIN}`);
    });
  } catch (error) {
    console.error('❌ Error al iniciar el servidor:', error);
    process.exit(1);
  }
}

// Manejo de cierre graceful
process.on('SIGTERM', async () => {
  console.log('🔄 Cerrando servidor...');
  await db.closePool();
  process.exit(0);
});

startServer();
