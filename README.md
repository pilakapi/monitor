# M3U Monitor Proxy

Aplicación web para monitoreo de URLs M3U con detección de dispositivos.

## Características

- **Gestión de Usuarios**: Crear, editar, eliminar usuarios con nombre, cédula, teléfono
- **URL Espejo**: Genera URLs únicas que interceptan el tráfico para detectar dispositivos
- **Detección de Dispositivos**: Móvil, Tablet, PC, Smart TV
- **Búsqueda**: Buscar usuarios por nombre
- **Autenticación**: PIN de 6 dígitos (198823)
- **Persistencia**: Base de datos Neon PostgreSQL

## Archivos

```
/workspace/
├── package.json      # Dependencias del proyecto
├── server.js         # Servidor Express principal
├── db.js             # Módulo de base de datos
├── index.html        # Interfaz de usuario
├── .env.example      # Ejemplo de variables de entorno
└── README.md         # Este archivo
```

## Instalación Local

1. **Instalar dependencias**:
```bash
npm install
```

2. **Configurar variables de entorno**:
```bash
cp .env.example .env
# Editar .env con la
```

3. URL de Neon **Iniciar servidor**:
```bash
npm start
```

4. **Acceder**: http://localhost:10000

## Despliegue en Render con Neon

### Paso 1: Crear Base de Datos en Neon

1. Ve a [Neon.tech](https://neon.tech) y crea una cuenta
2. Crea un nuevo proyecto
3. En "Connection Details", copia la URL de conexión
   - Formato: `postgresql://user:password@host.neon.tech/neondb?sslmode=require`

### Paso 2: Configurar Render

1. Crea una cuenta en [Render.com](https://render.com)
2. Crea un nuevo "Web Service"
3. Conecta tu repositorio GitHub
4. Configura:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`

### Paso 3: Variables de Entorno en Render

En la sección "Environment" de Render, agrega:

| Variable | Valor |
|----------|-------|
| `DATABASE_URL` | Tu URL de Neon (postgresql://...) |
| `PORT` | 10000 |

**Importante**: La URL de Neon debe terminar con `?sslmode=require`

### Paso 4: Desplegar

- Haz clic en "Deploy"
- Espera a que termine el build
- Tu aplicación estará disponible en la URL de Render

## Uso de la Aplicación

### Login
- PIN: **198823**

### Agregar Usuario
1. Click en "Agregar Usuario"
2. Completa los datos:
   - Nombre
   - Número de Cédula
   - Número de Teléfono
   - URL M3U Original
3. Click en "Guardar"

### URL Espejo
- Cada usuario genera una URL espejo única
- Format: `https://tu-app.onrender.com/m3u/UUID.m3u`
- **Esta URL NUNCA cambia** - puedes editar el usuario y seguirá funcionando
- Comparte esta URL con tus usuarios para ver quién accede

### Monitoreo
- Verifica quién accede a la lista M3U
- Muestra el tipo de dispositivo (Móvil, Tablet, PC, TV)
- Registra fecha y hora de cada acceso

## Détección de Dispositivos

La aplicación detecta automáticamente:
- 📱 **Móvil**: iPhone, Android
- 📱 **Tablet**: iPad, Android Tablet
- 💻 **PC**: Windows, Mac, Linux
- 📺 **TV**: Smart TV (LG, Samsung, Roku, Apple TV, etc.)

## Soporte

Si tienes problemas:
1. Verifica que la URL de Neon esté correcta
2. Revisa los logs en el dashboard de Render
3. Asegúrate de que `?sslmode=require` esté al final de la URL
