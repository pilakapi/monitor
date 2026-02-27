// Servidor Express para monitoreo M3U y gestión de usuarios
// Requiere: DATABASE_URL, ADMIN_PIN (opcional, default: 198823)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { customAlphabet } = require('nanoid');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Generador de slugs únicos (8 caracteres)
const generateSlug = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

// PIN de administrador
const ADMIN_PIN = process.env.ADMIN_PIN || '198823';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos (frontend)
app.use(express.static('.'));

// Función para generar un slug único
async function generateUniqueSlug() {
  let slug = generateSlug();
  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    const exists = await db.slugExists(slug);
    if (!exists) {
      return slug;
    }
    slug = generateSlug();
    attempts++;
  }
  
  // Si no encuentra uno único, agregar más caracteres
  return generateSlug() + generateSlug();
}

// ==================== RUTAS DE AUTENTICACIÓN ====================

// Login con PIN
app.post('/api/login', (req, res) => {
  const { pin } = req.body;
  
  if (!pin) {
    return res.status(400).json({ success: false, message: 'PIN requerido' });
  }
  
  if (pin === ADMIN_PIN) {
    // Generar un token simple (en producción usar JWT)
    const token = Buffer.from(`${ADMIN_PIN}:${Date.now()}`).toString('base64');
    return res.json({ 
      success: true, 
      token,
      message: 'Login exitoso' 
    });
  }
  
  return res.status(401).json({ 
    success: false, 
    message: 'PIN incorrecto' 
  });
});

// ==================== RUTAS DE API ====================

// Obtener todos los usuarios
app.get('/api/users', async (req, res) => {
  try {
    const { search } = req.query;
    
    let users;
    if (search) {
      users = await db.searchUsers(search);
    } else {
      users = await db.getAllUsers();
    }
    
    // Obtener dominio para las URLs
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    // Agregar URL espejo a cada usuario
    const usersWithMirrorUrl = users.map(user => ({
      ...user,
      mirror_url: `${baseUrl}/get/${user.slug}.m3u`,
      active_devices: parseInt(user.active_devices) || 0
    }));
    
    res.json({ success: true, users: usersWithMirrorUrl });
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ success: false, message: 'Error al obtener usuarios' });
  }
});

// Obtener un usuario específico
app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await db.getUserById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }
    
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    user.mirror_url = `${baseUrl}/get/${user.slug}.m3u`;
    user.active_devices = await db.getActiveDevices(user.id);
    
    res.json({ success: true, user });
  } catch (error) {
    console.error('Error al obtener usuario:', error);
    res.status(500).json({ success: false, message: 'Error al obtener usuario' });
  }
});

// Crear nuevo usuario
app.post('/api/users', async (req, res) => {
  try {
    const { name, cedula, phone, original_url } = req.body;
    
    // Validaciones
    if (!name || !original_url) {
      return res.status(400).json({ 
        success: false, 
        message: 'Nombre y URL M3U son requeridos' 
      });
    }
    
    // Generar slug único
    const slug = await generateUniqueSlug();
    
    // Crear usuario
    const user = await db.createUser({
      slug,
      name,
      cedula: cedula || '',
      phone: phone || '',
      original_url
    });
    
    // Responder con URL espejo
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    user.mirror_url = `${baseUrl}/get/${user.slug}.m3u`;
    user.active_devices = 0;
    
    res.status(201).json({ success: true, user, message: 'Usuario creado correctamente' });
  } catch (error) {
    console.error('Error al crear usuario:', error);
    res.status(500).json({ success: false, message: 'Error al crear usuario' });
  }
});

// Actualizar usuario
app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, cedula, phone, original_url } = req.body;
    
    // Verificar que existe
    const existingUser = await db.getUserById(id);
    if (!existingUser) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }
    
    // Validaciones
    if (!name || !original_url) {
      return res.status(400).json({ 
        success: false, 
        message: 'Nombre y URL M3U son requeridos' 
      });
    }
    
    // Actualizar usuario (el slug NO cambia)
    const user = await db.updateUser(id, {
      name,
      cedula: cedula || '',
      phone: phone || '',
      original_url
    });
    
    // Responder con URL espejo (la misma de siempre)
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    user.mirror_url = `${baseUrl}/get/${user.slug}.m3u`;
    user.active_devices = await db.getActiveDevices(user.id);
    
    res.json({ success: true, user, message: 'Usuario actualizado correctamente' });
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar usuario' });
  }
});

// Eliminar usuario
app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await db.deleteUser(id);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }
    
    res.json({ success: true, message: 'Usuario eliminado correctamente' });
  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar usuario' });
  }
});

// ==================== RUTA DE PROXY M3U ====================

// Endpoint para obtener el M3U y contar dispositivos
app.get('/get/:slug.m3u', async (req, res) => {
  try {
    const { slug } = req.params;
    
    // Obtener usuario por slug
    const user = await db.getUserBySlug(slug);
    
    if (!user) {
      return res.status(404).type('application/x-mpegurl').send('#EXTM3U\n#ERROR: Usuario no encontrado');
    }
    
    // Obtener información del cliente
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                      req.socket?.remoteAddress || 
                      'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    // Registrar acceso
    await db.logAccess(user.id, ipAddress, userAgent);
    
    console.log(`📱 Acceso registrado - Usuario: ${user.name}, IP: ${ipAddress}, slug: ${slug}`);
    
    // Realizar request a la URL original
    const response = await axios.get(user.original_url, {
      responseType: 'text',
      timeout: 30000,
      headers: {
        'User-Agent': 'M3U-Monitor/1.0',
        ...req.headers
      }
    });
    
    // Configurar headers de respuesta
    res.set({
      'Content-Type': 'application/x-mpegurl',
      'Content-Disposition': `attachment; filename="${slug}.m3u"`,
      'X-Accel-Buffering': 'no',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    // Enviar contenido M3U
    res.send(response.data);
  } catch (error) {
    console.error('Error al obtener M3U:', error.message);
    
    res.set('Content-Type', 'application/x-mpegurl');
    res.status(500).send('#EXTM3U\n#ERROR: Error al obtener la lista M3U');
  }
});

// ==================== RUTA DE PRUEBA ====================

app.get('/api/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Servidor funcionando correctamente',
    timestamp: new Date().toISOString()
  });
});

// ==================== INICIALIZACIÓN ====================

async function startServer() {
  try {
    // Inicializar base de datos
    await db.initDatabase();
    console.log('✅ Conectado a Neon PostgreSQL');
    
    // Iniciar servidor
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
      console.log(`🔐 PIN de admin: ${ADMIN_PIN}`);
      console.log(`🌐 URL base: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Error al iniciar el servidor:', error);
    process.exit(1);
  }
}

startServer();
