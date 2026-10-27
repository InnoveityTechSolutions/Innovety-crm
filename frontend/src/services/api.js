import axios from 'axios';
import { io } from 'socket.io-client';

const getApiUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;
  if (import.meta.env.PROD) {
    console.error('[Production Config Warning] VITE_API_URL environment variable is required for production deployment.');
    return '/api';
  }
  return 'http://localhost:5000/api';
};

const API_URL = getApiUrl();

const api = axios.create({
  baseURL: API_URL
});

// Attach Authorization Bearer token before request is sent
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    } else {
      delete config.headers.Authorization;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

let isRedirecting = false;
let isManualLogoutInProgress = false;

export const setManualLogoutFlag = (val = true) => {
  isManualLogoutInProgress = val;
};

export const isManualLogout = () => {
  return isManualLogoutInProgress;
};

// Clear authentication and session data while preserving saved company login themes
export const clearAuthStorage = () => {
  try {
    const preserved = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (
        key === 'mrf_login_primary_color' ||
        key === 'mrf_selected_company_id' ||
        key.startsWith('mrf_login_theme_') ||
        key.startsWith('mrf_theme_') ||
        key.startsWith('mrf_mode_') ||
        key.startsWith('attendance_audit_selected_members_') ||
        key === 'sidebar_pinned'
      ) {
        preserved[key] = localStorage.getItem(key);
      }
    }
    localStorage.clear();
    sessionStorage.clear();
    Object.entries(preserved).forEach(([k, v]) => {
      if (v !== null) {
        localStorage.setItem(k, v);
      }
    });
  } catch (e) {
    console.warn('Error clearing auth storage:', e);
  }
};

// Intercept 401 Unauthorized responses to attempt silent token renewal
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Do not trigger session expired redirect if user explicitly initiated manual logout
    if (isManualLogoutInProgress) {
      return Promise.reject(error);
    }

    // Only attempt refresh if 401 Unauthorized, request has not already retried, and is not an auth request itself
    if (
      error.response &&
      error.response.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/login') &&
      !originalRequest.url?.includes('/auth/refresh')
    ) {
      originalRequest._retry = true;
      const savedToken = localStorage.getItem('token');
      const savedRefreshToken = localStorage.getItem('refreshToken');

      if (savedToken || savedRefreshToken) {
        try {
          const refreshRes = await axios.post(`${API_URL}/auth/refresh`, {
            token: savedToken,
            refreshToken: savedRefreshToken
          });

          if (refreshRes.data && refreshRes.data.token) {
            const newToken = refreshRes.data.token;
            localStorage.setItem('token', newToken);
            if (refreshRes.data.refreshToken) {
              localStorage.setItem('refreshToken', refreshRes.data.refreshToken);
            }
            if (refreshRes.data.user) {
              localStorage.setItem('user', JSON.stringify(refreshRes.data.user));
            }

            originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
            return api(originalRequest);
          }
        } catch (refreshErr) {
          console.warn('[API Auth] Silent token renewal failed:', refreshErr?.message);
        }
      }

      // If token renewal failed or no token exists, log out user
      if (!isManualLogoutInProgress) {
        console.log('Session expired or unauthorized. Logging out...');
        clearAuthStorage();
        if (!isRedirecting && !window.location.search.includes('expired=true')) {
          isRedirecting = true;
          if (window.location.pathname.includes('/login')) {
            window.location.search = '?expired=true';
          } else {
            window.location.href = '/login?expired=true';
          }
        }
      }
    }

    // Resilience: Gracefully retry once on 429 Rate Limit with exponential backoff
    if (error.response && error.response.status === 429 && originalRequest && !originalRequest._retry429) {
      originalRequest._retry429 = true;
      const retryAfter = error.response.data?.retryAfterMs || 1000;
      await new Promise(resolve => setTimeout(resolve, Math.min(retryAfter, 1500)));
      return api(originalRequest);
    }

    return Promise.reject(error);
  }
);

export const getUploadUrl = (path) => {
  if (!path || typeof path !== 'string' || !path.trim()) return '';
  const trimmed = path.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return encodeURI(trimmed);
  }

  let cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

  if (cleanPath.startsWith('/uploads/')) {
    cleanPath = `/api${cleanPath}`;
  }

  const backendServer = API_URL.replace(/\/api\/?$/, '');
  return encodeURI(`${backendServer}${cleanPath}`);
};

export const downloadChatAttachment = async (messageOrPath, customFileName) => {
  try {
    let downloadUrl = '';
    let defaultName = '';

    if (typeof messageOrPath === 'object' && messageOrPath !== null) {
      const msg = messageOrPath;
      defaultName = msg.fileName || msg.originalFileName || customFileName || msg.name || '';
      if (!defaultName && msg.attachmentUrl) {
        defaultName = msg.attachmentUrl.split('/').pop().split('\\').pop();
      }
      if (msg.id) {
        downloadUrl = `${API_URL}/chat/messages/${msg.id}/download`;
      } else if (msg.attachmentUrl) {
        downloadUrl = `${API_URL}/download-file?file=${encodeURIComponent(msg.attachmentUrl)}&name=${encodeURIComponent(defaultName)}`;
      } else if (msg.url) {
        downloadUrl = `${API_URL}/download-file?file=${encodeURIComponent(msg.url)}&name=${encodeURIComponent(msg.name || defaultName)}`;
      }
    } else if (typeof messageOrPath === 'string') {
      const inputStr = messageOrPath.trim();
      defaultName = customFileName || '';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inputStr)) {
        downloadUrl = `${API_URL}/chat/messages/${inputStr}/download`;
      } else {
        downloadUrl = `${API_URL}/download-file?file=${encodeURIComponent(inputStr)}&name=${encodeURIComponent(defaultName)}`;
      }
    }

    if (!downloadUrl) return false;

    const token = localStorage.getItem('token');
    const response = await fetch(downloadUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });

    if (!response.ok) {
      throw new Error(`Download HTTP error! status: ${response.status}`);
    }

    let filename = '';
    const disposition = response.headers.get('content-disposition');
    if (disposition) {
      const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      if (utf8Match && utf8Match[1]) {
        filename = decodeURIComponent(utf8Match[1]);
      } else {
        const match = disposition.match(/filename="?([^";]+)"?/i);
        if (match && match[1]) {
          filename = decodeURIComponent(match[1]);
        }
      }
    }

    if (!filename || filename === 'undefined') {
      filename = defaultName || 'download';
    }

    filename = filename.replace(/^"|"$/g, '').trim();

    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
    return true;
  } catch (error) {
    console.error('Authenticated chat download error:', error);
    throw error;
  }
};

export const downloadFile = async (filePath, customFileName) => {
  return downloadChatAttachment(filePath, customFileName);
};

let socketInstance = null;

export const getSocket = () => {
  const token = localStorage.getItem('token');
  if (!token) {
    return null;
  }

  if (!socketInstance) {
    let backendServer = '';
    if (API_URL.startsWith('http://') || API_URL.startsWith('https://')) {
      backendServer = API_URL.replace(/\/api\/?$/, '');
    } else {
      backendServer = window.location.origin;
    }

    socketInstance = io(backendServer, {
      auth: {
        token
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    socketInstance.on('connect', () => {
      console.log('[CLIENT CONNECT] Socket connected:', socketInstance.id);
    });

    socketInstance.on('connect_error', (err) => {
      console.warn('[CLIENT CONNECT ERROR]', err.message);
    });

    socketInstance.on('disconnect', (reason) => {
      console.log('[CLIENT DISCONNECT] Socket disconnected:', reason);
    });
  } else if (socketInstance.disconnected) {
    socketInstance.auth = { token };
    socketInstance.connect();
  }

  return socketInstance;
};

export const disconnectSocket = () => {
  if (socketInstance) {
    try {
      if (socketInstance.connected) {
        socketInstance.emit('logout');
      }
      socketInstance.disconnect();
    } catch (e) {
      console.warn('Socket disconnect error:', e);
    }
    socketInstance = null;
  }
};

export default api;
