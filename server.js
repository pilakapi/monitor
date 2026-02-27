require('dotenv').config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const PIN_CODE = process.env.PIN_CODE || "198823";

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Database connection - Neon PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Initialize database tables
async function initDatabase() {
  const client = await pool.connect();
  try {
    // Create monitors table with new fields
    await client.query(`
      CREATE TABLE IF NOT EXISTS monitors (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        proxy_url TEXT,
        interval_seconds INTEGER DEFAULT 60,
        is_active INTEGER DEFAULT 1,
        cedula TEXT,
        phone TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create metrics table
    await client.query(`
      CREATE TABLE IF NOT EXISTS metrics (
        id SERIAL PRIMARY KEY,
        monitor_id INTEGER NOT NULL,
        status_code INTEGER,
        response_time_ms INTEGER,
        viewers INTEGER DEFAULT 0,
        is_online INTEGER DEFAULT 0,
        error_message TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
      )
    `);

    // Create device_stats table
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_stats (
        id SERIAL PRIMARY KEY,
        monitor_id INTEGER NOT NULL,
        device_type TEXT NOT NULL,
        device_info TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
      )
    `);

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_metrics_monitor_time ON metrics(monitor_id, timestamp)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_device_stats_monitor_time ON device_stats(monitor_id, timestamp)
    `);

    console.log("✅ Database initialized successfully");
  } catch (error) {
    console.error("❌ Database initialization error:", error.message);
  } finally {
    client.release();
  }
}

// ==========================================
// DEVICE DETECTION
// ==========================================

function detectDeviceType(userAgent) {
  if (!userAgent) return 'unknown';

  const ua = userAgent.toLowerCase();

  // TV detection
  if (/tv|smarttv|googletv|appletv|roku|firetv|chromecast|android tv|netcast|nettv|hbbtv|ce-html|xbmc|playstation|nsd|netfront|boxee|kylo|sonytv|bravo|polestar/.test(ua)) {
    return 'tv';
  }

  // Tablet detection
  if (/tablet|ipad|tab|kindle|nexus 7|xoom|transformer|slider|m1|.2 7|.3 7|101ml|101g2|101tc|sm-t|sgp|gt-p|sm-p|android 3|playbook/.test(ua)) {
    return 'tablet';
  }

  // Mobile detection
  if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini|opera mobi|windows phone|symbian|series60|windows ce|palm|minimo|netfront|ucweb|bolt|iris|3g_t|windows mobile|zte|meego|huawei/.test(ua)) {
    return 'mobile';
  }

  // PC/Desktop default
  if (/windows|macintosh|linux|x11|unix|cros|chrome/.test(ua)) {
    return 'pc';
  }

  return 'unknown';
}

// ==========================================
// AUTH MIDDLEWARE
// ==========================================

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || authHeader !== `Bearer ${PIN_CODE}`) {
    return res.status(401).json({ error: "Acceso no autorizado" });
  }

  next();
}

// ==========================================
// API ENDPOINTS
// ==========================================

// Login with PIN
app.post("/api/login", (req, res) => {
  const { pin } = req.body;

  if (pin === PIN_CODE) {
    res.json({ success: true, token: PIN_CODE });
  } else {
    res.status(401).json({ error: "PIN incorrecto" });
  }
});

// Get all monitors with latest data and search functionality
app.get("/api/monitors", async (req, res) => {
  try {
    const { search } = req.query;

    let query = `
      SELECT
        m.*,
        (SELECT status_code FROM metrics WHERE monitor_id = m.id ORDER BY timestamp DESC LIMIT 1) as last_status,
        (SELECT response_time_ms FROM metrics WHERE monitor_id = m.id ORDER BY timestamp DESC LIMIT 1) as last_response_time,
        (SELECT viewers FROM metrics WHERE monitor_id = m.id ORDER BY timestamp DESC LIMIT 1) as last_viewers,
        (SELECT is_online FROM metrics WHERE monitor_id = m.id ORDER BY timestamp DESC LIMIT 1) as last_online,
        (SELECT timestamp FROM metrics WHERE monitor_id = m.id ORDER BY timestamp DESC LIMIT 1) as last_check,
        (SELECT COUNT(*) FROM metrics WHERE monitor_id = m.id AND is_online = 1 AND timestamp > NOW() - INTERVAL '24 hours') as uptime_24h,
        (SELECT COUNT(*) FROM metrics WHERE monitor_id = m.id AND timestamp > NOW() - INTERVAL '24 hours') as total_checks_24h
      FROM monitors m
      WHERE m.is_active = 1
    `;

    // Add search filter if provided
    if (search && search.trim() !== '') {
      query += ` AND (m.name ILIKE $1 OR m.cedula ILIKE $1 OR m.phone ILIKE $1)`;
    }

    query += ` ORDER BY m.created_at DESC`;

    const params = search && search.trim() !== '' ? [`%${search.trim()}%`] : [];
    const monitorsResult = await pool.query(query, params);
    const monitors = monitorsResult.rows;

    // Get device stats for each monitor
    const monitorsWithDevices = await Promise.all(monitors.map(async (monitor) => {
      const deviceStatsResult = await pool.query(`
        SELECT
          device_type,
          COUNT(*) as count
        FROM device_stats
        WHERE monitor_id = $1 AND timestamp > NOW() - INTERVAL '1 hour'
        GROUP BY device_type
      `, [monitor.id]);

      const devices = { mobile: 0, tablet: 0, tv: 0, pc: 0, unknown: 0 };
      deviceStatsResult.rows.forEach(stat => {
        devices[stat.device_type] = parseInt(stat.count);
      });

      return {
        ...monitor,
        devices
      };
    }));

    res.json(monitorsWithDevices);
  } catch (error) {
    console.error("Error fetching monitors:", error);
    res.status(500).json({ error: error.message });
  }
});

// Create new monitor
app.post("/api/monitors", async (req, res) => {
  const { name, url, interval_seconds = 60, cedula = '', phone = '' } = req.body;

  if (!name || !url) {
    return res.status(400).json({ error: "Nombre y URL son requeridos" });
  }

  try {
    // Generate unique proxy token
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    // Generate HTTPS URL ending in .m3u
    const proxyUrl = `https://${req.get('host')}/stream/${token}.m3u`;

    const result = await pool.query(`
      INSERT INTO monitors (name, url, proxy_url, interval_seconds, cedula, phone)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [name, url, proxyUrl, interval_seconds, cedula, phone]);

    const newMonitor = result.rows[0];

    // Execute first check immediately
    checkMonitor(newMonitor);

    res.json(newMonitor);
  } catch (error) {
    console.error("Error creating monitor:", error);
    res.status(500).json({ error: error.message });
  }
});

// Delete monitor
app.delete("/api/monitors/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query("DELETE FROM metrics WHERE monitor_id = $1", [id]);
    await pool.query("DELETE FROM device_stats WHERE monitor_id = $1", [id]);
    await pool.query("DELETE FROM monitors WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting monitor:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get metrics for a monitor
app.get("/api/metrics/:id", async (req, res) => {
  const { id } = req.params;
  const { range = "24h" } = req.query;

  let timeFilter = "NOW() - INTERVAL '24 hours'";
  if (range === "7d") timeFilter = "NOW() - INTERVAL '7 days'";
  if (range === "30d") timeFilter = "NOW() - INTERVAL '30 days'";

  try {
    const metricsResult = await pool.query(`
      SELECT * FROM metrics
      WHERE monitor_id = $1 AND timestamp > ${timeFilter}
      ORDER BY timestamp ASC
    `, [id]);

    res.json(metricsResult.rows);
  } catch (error) {
    console.error("Error fetching metrics:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get device statistics for a monitor
app.get("/api/devices/:id", async (req, res) => {
  const { id } = req.params;
  const { range = "24h" } = req.query;

  let timeFilter = "NOW() - INTERVAL '24 hours'";
  if (range === "7d") timeFilter = "NOW() - INTERVAL '7 days'";
  if (range === "30d") timeFilter = "NOW() - INTERVAL '30 days'";

  try {
    const statsResult = await pool.query(`
      SELECT
        device_type,
        COUNT(*) as count,
        MAX(timestamp) as last_seen
      FROM device_stats
      WHERE monitor_id = $1 AND timestamp > ${timeFilter}
      GROUP BY device_type
      ORDER BY count DESC
    `, [id]);

    // Get time series data for devices
    const timeSeriesResult = await pool.query(`
      SELECT
        TO_CHAR(timestamp, 'YYYY-MM-DD HH24:00:00') as hour,
        device_type,
        COUNT(*) as count
      FROM device_stats
      WHERE monitor_id = $1 AND timestamp > ${timeFilter}
      GROUP BY hour, device_type
      ORDER BY hour ASC
    `, [id]);

    res.json({ stats: statsResult.rows, timeSeries: timeSeriesResult.rows });
  } catch (error) {
    console.error("Error fetching device stats:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get aggregated statistics
app.get("/api/stats/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) as total_checks,
        SUM(CASE WHEN is_online = 1 THEN 1 ELSE 0 END) as online_checks,
        AVG(response_time_ms) as avg_response_time,
        MAX(viewers) as max_viewers,
        AVG(viewers) as avg_viewers
      FROM metrics
      WHERE monitor_id = $1 AND timestamp > NOW() - INTERVAL '24 hours'
    `, [id]);

    const stats = statsResult.rows[0];

    // Uptime percentage
    stats.uptime_percent = stats.total_checks > 0
      ? Math.round((parseInt(stats.online_checks) / parseInt(stats.total_checks)) * 100)
      : 0;

    // Get device breakdown
    const deviceStatsResult = await pool.query(`
      SELECT
        device_type,
        COUNT(*) as count
      FROM device_stats
      WHERE monitor_id = $1 AND timestamp > NOW() - INTERVAL '24 hours'
      GROUP BY device_type
    `, [id]);

    const devices = { mobile: 0, tablet: 0, tv: 0, pc: 0, unknown: 0 };
    deviceStatsResult.rows.forEach(stat => {
      devices[stat.device_type] = parseInt(stat.count);
    });

    stats.devices = devices;

    res.json(stats);
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: error.message });
  }
});

// Toggle active/inactive
app.post("/api/monitors/:id/toggle", async (req, res) => {
  const { id } = req.params;

  try {
    const monitorResult = await pool.query("SELECT is_active FROM monitors WHERE id = $1", [id]);
    const monitor = monitorResult.rows[0];

    if (!monitor) {
      return res.status(404).json({ error: "Monitor no encontrado" });
    }

    const newStatus = monitor.is_active === 1 ? 0 : 1;

    await pool.query("UPDATE monitors SET is_active = $1 WHERE id = $2", [newStatus, id]);

    res.json({ success: true, is_active: newStatus });
  } catch (error) {
    console.error("Error toggling monitor:", error);
    res.status(500).json({ error: error.message });
  }
});

// Generate new proxy URL for a monitor
app.post("/api/monitors/:id/regenerate-proxy", async (req, res) => {
  const { id } = req.params;

  try {
    const monitorResult = await pool.query("SELECT * FROM monitors WHERE id = $1", [id]);
    const monitor = monitorResult.rows[0];

    if (!monitor) {
      return res.status(404).json({ error: "Monitor no encontrado" });
    }

    // Generate unique proxy token
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    // Generate HTTPS URL ending in .m3u
    const proxyUrl = `https://${req.get('host')}/stream/${token}.m3u`;

    await pool.query("UPDATE monitors SET proxy_url = $1 WHERE id = $2", [proxyUrl, id]);

    res.json({ success: true, proxy_url: proxyUrl });
  } catch (error) {
    console.error("Error regenerating proxy:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// PROXY STREAM ENDPOINT - Serves M3U content
// ==========================================

app.get("/stream/:token", async (req, res) => {
  const { token } = req.params;
  const userAgent = req.headers['user-agent'] || '';
  const deviceType = detectDeviceType(userAgent);

  try {
    // Find monitor by proxy token (extract token without .m3u extension if present)
    const cleanToken = token.replace('.m3u', '');

    const monitorsResult = await pool.query(`
      SELECT * FROM monitors
      WHERE is_active = 1
      AND proxy_url LIKE $1
    `, [`%${cleanToken}%`]);

    let monitor = monitorsResult.rows[0];

    if (!monitor) {
      return res.status(404).send("Stream no encontrado");
    }

    // Record device access
    await pool.query(`
      INSERT INTO device_stats (monitor_id, device_type, device_info)
      VALUES ($1, $2, $3)
    `, [monitor.id, deviceType, JSON.stringify({
      userAgent: userAgent.substring(0, 500),
      ip: req.ip,
      referer: req.headers['referer'] || ''
    })]);

    // Fetch and proxy the M3U content
    const response = await axios.get(monitor.url, {
      timeout: 15000,
      headers: {
        "User-Agent": userAgent || "M3U-Proxy/1.0"
      },
      responseType: 'text'
    });

    // Set appropriate headers for M3U content
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.set('Content-Disposition', 'inline; filename="playlist.m3u"');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.send(response.data);

  } catch (error) {
    console.error("Proxy error:", error.message);
    res.status(502).send("Error al obtener el stream");
  }
});

// Also support direct .m3u extension routes
app.get("/stream/:token.m3u", async (req, res) => {
  const { token } = req.params;
  const userAgent = req.headers['user-agent'] || '';
  const deviceType = detectDeviceType(userAgent);

  try {
    // Find monitor by proxy token
    const monitorsResult = await pool.query(`
      SELECT * FROM monitors
      WHERE is_active = 1
      AND proxy_url LIKE $1
    `, [`%${token}%`]);

    let monitor = monitorsResult.rows[0];

    if (!monitor) {
      return res.status(404).send("Stream no encontrado");
    }

    // Record device access
    await pool.query(`
      INSERT INTO device_stats (monitor_id, device_type, device_info)
      VALUES ($1, $2, $3)
    `, [monitor.id, deviceType, JSON.stringify({
      userAgent: userAgent.substring(0, 500),
      ip: req.ip,
      referer: req.headers['referer'] || ''
    })]);

    // Fetch and proxy the M3U content
    const response = await axios.get(monitor.url, {
      timeout: 15000,
      headers: {
        "User-Agent": userAgent || "M3U-Proxy/1.0"
      },
      responseType: 'text'
    });

    // Set appropriate headers for M3U content
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.set('Content-Disposition', 'inline; filename="playlist.m3u"');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.send(response.data);

  } catch (error) {
    console.error("Proxy error:", error.message);
    res.status(502).send("Error al obtener el stream");
  }
});

// ==========================================
// MONITORING WORKER
// ==========================================

async function checkMonitor(monitor) {
  const startTime = Date.now();

  try {
    const response = await axios.get(monitor.url, {
      timeout: 10000,
      headers: {
        "User-Agent": "M3U-Sentinel/1.0"
      }
    });

    const responseTime = Date.now() - startTime;
    const statusCode = response.status;

    // Try to get viewers from response if JSON
    let viewers = 0;
    try {
      if (response.headers['content-type'] && response.headers['content-type'].includes('application/json')) {
        const data = response.data;
        viewers = data.viewers || data.users || data.connections ||
                  data.active_users || data.current_viewers || 0;
      }
    } catch (e) {
      // Not JSON, ignore
    }

    await pool.query(`
      INSERT INTO metrics (monitor_id, status_code, response_time_ms, viewers, is_online, error_message)
      VALUES ($1, $2, $3, $4, 5, NULL)
    `, [monitor.id, statusCode, responseTime, viewers]);

  } catch (error) {
    const responseTime = Date.now() - startTime;
    const statusCode = error.response ? error.response.status : 0;
    const errorMessage = error.message;

    await pool.query(`
      INSERT INTO metrics (monitor_id, status_code, response_time_ms, viewers, is_online, error_message)
      VALUES ($1, $2, $3, 0, 0, $4)
    `, [monitor.id, statusCode, responseTime, errorMessage]);
  }
}

// Worker that runs every 30 seconds
function startWorker() {
  console.log("🔄 Starting monitoring worker...");

  setInterval(async () => {
    try {
      const monitorsResult = await pool.query(`
        SELECT * FROM monitors
        WHERE is_active = 1
      `);
      const monitors = monitorsResult.rows;

      for (const monitor of monitors) {
        await checkMonitor(monitor);
      }

      if (monitors.length > 0) {
        console.log(`✅ Checks completed: ${monitors.length} monitors`);
      }
    } catch (error) {
      console.error("❌ Worker error:", error.message);
    }
  }, 30000); // Every 30 seconds
}

// Cleanup old data (keep only 30 days)
function cleanupOldData() {
  setInterval(async () => {
    try {
      await pool.query(`
        DELETE FROM metrics
        WHERE timestamp < NOW() - INTERVAL '30 days'
      `);

      await pool.query(`
        DELETE FROM device_stats
        WHERE timestamp < NOW() - INTERVAL '30 days'
      `);

      console.log("🧹 Old data cleanup completed");
    } catch (error) {
      console.error("❌ Cleanup error:", error.message);
    }
  }, 86400000); // Once a day
}

// Start server
async function start() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log("========================================");
      console.log("  Monitor started");
      console.log("  Port: " + PORT);
      console.log("  Dashboard: http://localhost:" + PORT);
      console.log("  PIN Code: " + PIN_CODE);
      console.log("  Database: Neon PostgreSQL");
      console.log("========================================");

      startWorker();
      cleanupOldData();
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

start();
