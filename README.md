# M3U Monitor - Aplicación de Monitoreo IPTV

Aplicación web para gestionar URLs M3U y monitorear dispositivos conectados en tiempo real.

## Características

- 🔐 **Autenticación segura** con PIN de 6 dígitos (198823)
- 👥 **Gestión de usuarios** - Crear, editar, eliminar usuarios
- 📊 **Monitoreo en tiempo real** - Contador de dispositivos activos
- 🔗 **URLs espejo** - Genera URLs cortas que interceptan el tráfico
- 🔍 **Buscador** - Filtrar usuarios por nombre
- 📱 **Diseño responsivo** - Funciona en dispositivos móviles

## Archivos

```
├── index.html      # Interfaz de usuario (Frontend)
├── server.js       # Servidor Express (Backend API)
├── db.js           # Conexión a base de datos Neon
├── package.json    # Dependencias de Node.js
└── .env.example    # Ejemplo de variables de entorno
```

## Instalación Local

1. **Clona el repositorio:**
   ```bash
   git clone <tu-repositorio>
   cd m3u-monitor
   ```

2. **Instala las dependencias:**
   ```bash
   npm install
   ```

3. **Configura las variables de entorno:**
   ```bash
   cp .env.example .env
   # Edita .env con tu URL de Neon
   ```

4. **Inicia el servidor:**
   ```bash
   npm start
   ```

5. **Accede a la aplicación:**
   ```
   http://localhost:3000
   ```

## Configuración de Neon (Base de Datos)

### Paso 1: Crear proyecto en Neon

1. Ve a [Neon.tech](https://neon.tech)
2. Crea una cuenta gratuita
3. Crea un nuevo proyecto
4. Copia la URL de conexión (Connection String)

### Paso 2: La URL de conexión se verá así:
```
postgres://username:password@ep-xyz.us-east-1.aws.neon.tech/neondb?sslmode=require
```

## Despliegue en Render

### Paso 1: Preparar GitHub

1. Sube todos los archivos a un repositorio GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/tu-usuario/m3u-monitor.git
   git push -u origin main
   ```

### Paso 2: Crear base de datos en Neon

1. Ve a [Neon Console](https://console.neon.tech)
2. Selecciona tu proyecto
3. Ve a **Branches** y crea una rama llamada `main`
4. Copia la **Connection String** de la rama `main`

### Paso 3: Crear Web Service en Render

1. Ve a [Render Dashboard](https://dashboard.render.com)
2. Click en **New +** → **Web Service**
3. Conecta tu repositorio GitHub
4. Configura:
   - **Name:** `m3u-monitor`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`

### Paso 4: Configurar Variables de Entorno

En Render, agrega las siguientes variables en la sección **Environment**:

| Variable | Valor |
|----------|-------|
| `DATABASE_URL` | La URL de conexión de Neon (incluye `?sslmode=require`) |
| `ADMIN_PIN` | `198823` |
| `PORT` | `3000` |

**⚠️ IMPORTANTE:** La URL de Neon debe terminar con `?sslmode=require` para funcionar correctamente con Render.

### Paso 5: Desplegar

1. Click en **Create Web Service**
2. Espera a que termine el build (puede tomar 2-3 minutos)
3. Tu aplicación estará disponible en `https://m3u-monitor.onrender.com`

## Uso de la Aplicación

### Iniciar sesión
- PIN: `198823`

### Crear usuario
1. Click en **Nuevo Usuario**
2. Ingresa los datos del cliente
3. Ingresa la URL M3U original del proveedor
4. Click en **Guardar**
5. Se generará una URL espejo automáticamente

### URL Espejo
- La URL generada termina en `.m3u`
- **Nunca cambia** aunque edités los datos del usuario
- Úsala en tu aplicación IPTV para descargar los canales
- Cada vez que un dispositivo acceda, se registrará en el contador

### Monitoreo
- Los dispositivos se cuentan cuando acceden a la URL espejo
- Un dispositivo se considera "activo" si ha accedido en los últimos 5 minutos
- El contador se actualiza automáticamente cada 30 segundos

## Estructura de la URL Espejo

```
https://tu-dominio.onrender.com/get/abc123.m3u
```

Donde `abc123` es un código único generado para cada usuario.

## Solución de Problemas

### Error de conexión a la base de datos
- Verifica que la `DATABASE_URL` sea correcta
- Asegúrate de que termine con `?sslmode=require`
- Verifica que el proyecto de Neon esté activo

### La aplicación no responde
- Revisa los logs en el dashboard de Render
- Verifica que el puerto esté configurado como `3000`

### Error al cargar usuarios
- Asegúrate de que las tablas estén creadas (db.js lo hace automáticamente)
- Verifica la conexión a la base de datos

## Tecnologías

- **Backend:** Node.js, Express
- **Base de datos:** PostgreSQL (Neon)
- **Frontend:** HTML, Tailwind CSS, Vanilla JavaScript
- **Deployment:** Render

## Licencia

MIT
