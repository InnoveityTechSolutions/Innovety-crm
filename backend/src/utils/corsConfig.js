/**
 * Centralized CORS & Allowed Origin Security Policy
 *
 * Configurable via:
 * - FRONTEND_URL (Primary frontend origin, e.g. https://crm.innoveity.tech)
 * - ALLOWED_ORIGINS (Comma-separated list of additional allowed origins)
 *
 * Automatically permits local development servers (Vite 5173/5174, etc.) in non-production environments.
 */

const buildAllowedOrigins = () => {
  const origins = new Set();

  // 1. Primary configured FRONTEND_URL
  if (process.env.FRONTEND_URL) {
    origins.add(process.env.FRONTEND_URL.trim().replace(/\/+$/, ''));
  }

  // 2. Additional configured origins (comma-separated)
  if (process.env.ALLOWED_ORIGINS) {
    process.env.ALLOWED_ORIGINS.split(',')
      .map(o => o.trim().replace(/\/+$/, ''))
      .filter(Boolean)
      .forEach(o => origins.add(o));
  }

  // 3. Fallback production origin if nothing specified in production
  if (origins.size === 0) {
    origins.add('https://crm.innoveity.tech');
  }

  // 4. Default local development origins
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:5173');
    origins.add('http://localhost:5174');
    origins.add('http://127.0.0.1:5173');
    origins.add('http://127.0.0.1:5174');
    origins.add('http://localhost:3000');
    origins.add('http://localhost:3002');
    origins.add('http://localhost:5000');
  }

  return origins;
};

const isOriginAllowed = (origin) => {
  // Allow non-browser requests (curl, server-to-server, automated test scripts)
  if (!origin) return true;

  const cleanOrigin = String(origin).trim().replace(/\/+$/, '');
  const allowedOrigins = buildAllowedOrigins();

  if (allowedOrigins.has(cleanOrigin)) {
    return true;
  }

  // In non-production environments, permit any localhost or 127.0.0.1 port
  if (process.env.NODE_ENV !== 'production') {
    if (cleanOrigin.startsWith('http://localhost:') || cleanOrigin.startsWith('http://127.0.0.1:')) {
      return true;
    }
  }

  return false;
};

const corsOriginValidator = (origin, callback) => {
  if (isOriginAllowed(origin)) {
    return callback(null, true);
  }

  const cleanOrigin = String(origin).trim().replace(/\/+$/, '');
  console.warn(`[CORS Blocked] Origin "${cleanOrigin}" not allowed by CORS policy.`);
  return callback(new Error(`CORS policy: Access denied for origin ${cleanOrigin}`));
};

const corsOptions = {
  origin: corsOriginValidator,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Disposition']
};

module.exports = {
  buildAllowedOrigins,
  isOriginAllowed,
  corsOriginValidator,
  corsOptions
};
