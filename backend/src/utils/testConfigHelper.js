/**
 * Standard Test Target & Safety Configuration Helper
 *
 * Resolves test target from:
 * 1. process.env.TEST_API_URL (e.g. "http://localhost:3002/api")
 * 2. process.env.TEST_PORT (e.g. 3002 or 5000)
 * 3. Default fallback: http://localhost:5000/api
 *
 * Safety Guard:
 * Blocks destructive tests from executing against production (crm.innoveity.tech).
 */

const getTestConfig = ({ defaultPort = 5000, isDestructive = false } = {}) => {
  const port = process.env.TEST_PORT || process.env.PORT || defaultPort;
  let apiUrl = process.env.TEST_API_URL || `http://localhost:${port}/api`;

  apiUrl = apiUrl.trim().replace(/\/+$/, '');
  if (!apiUrl.endsWith('/api') && !apiUrl.includes('/api/')) {
    apiUrl = `${apiUrl}/api`;
  }

  const parsed = new URL(apiUrl);
  const hostname = parsed.hostname;
  const targetPort = parsed.port || (parsed.protocol === 'https:' ? 443 : 80);
  const serverUrl = `${parsed.protocol}//${parsed.host}`;
  const socketUrl = process.env.TEST_SOCKET_URL || serverUrl;

  // Strict Production Safety Guard
  if (isDestructive && (hostname === 'crm.innoveity.tech' || apiUrl.includes('innoveity.tech'))) {
    if (process.env.ALLOW_DESTRUCTIVE_PRODUCTION_TEST !== 'true') {
      const errorMsg = `[CRITICAL SAFETY BLOCK] Destructive test prevented from running against production host (${hostname}). Set ALLOW_DESTRUCTIVE_PRODUCTION_TEST=true only if explicitly authorized.`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  return {
    apiUrl,
    serverUrl,
    socketUrl,
    hostname,
    port: Number(targetPort),
    protocol: parsed.protocol
  };
};

module.exports = {
  getTestConfig
};
