import React, { createContext, useState, useEffect, useContext } from 'react';
import api, { disconnectSocket, setManualLogoutFlag, clearAuthStorage } from '../services/api';
import { setPlatformBranding } from '../utils/branding';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isTempPassword, setIsTempPassword] = useState(false);

  const logout = (isManual = false) => {
    if (isManual) {
      setManualLogoutFlag(true);
    }
    // 1. Drop authorization header immediately
    if (api.defaults.headers.common) {
      delete api.defaults.headers.common['Authorization'];
    }

    // 2. Clear auth state in React
    setToken(null);
    setUser(null);
    setIsTempPassword(false);

    // 3. Asynchronously perform storage cleanup and socket disconnection in background
    setTimeout(() => {
      clearAuthStorage();
      disconnectSocket();
      setPlatformBranding();
    }, 0);
  };

  useEffect(() => {
    const initializeAuth = async () => {
      const savedToken = localStorage.getItem('token');
      const savedUser = localStorage.getItem('user');

      if (savedToken && savedUser) {
        try {
          const parsedUser = JSON.parse(savedUser);
          setToken(savedToken);
          setUser(parsedUser);

          // Verify token session with fresh profile pull in background
          try {
            const res = await api.get('/auth/profile');
            if (res.data) {
              setUser(res.data);
              localStorage.setItem('user', JSON.stringify(res.data));
            }
          } catch (profileErr) {
            console.warn('[AuthContext] Background profile check notice:', profileErr?.message);
            // ONLY log out if server explicitly returned HTTP 401 Unauthorized or HTTP 403 Forbidden
            if (profileErr.response && (profileErr.response.status === 401 || profileErr.response.status === 403)) {
              console.error('[AuthContext] Session invalid (401/403). Logging out user.');
              logout();
            }
            // For network errors (offline mode, cold PWA launch delay, server startup), keep cached user session active!
          }
        } catch (parseError) {
          console.error('[AuthContext] Session parse failed:', parseError);
          logout();
        }
      } else {
        logout();
      }
      setLoading(false);
    };

    initializeAuth();
  }, []);

  const login = async (userId, password, options = {}) => {
    setManualLogoutFlag(false);
    setLoading(true);
    try {
      // Clear any stale cached data and tokens from prior session
      disconnectSocket();
      if (api.defaults.headers.common) {
        delete api.defaults.headers.common['Authorization'];
      }
      clearAuthStorage();
      setToken(null);
      setUser(null);

      const res = await api.post('/auth/login', {
        userId,
        employeeId: userId,
        email: userId,
        password,
        ...options
      });
      const { token, refreshToken, user: userData, isTempPassword } = res.data;

      localStorage.setItem('token', token);
      if (refreshToken) {
        localStorage.setItem('refreshToken', refreshToken);
      }
      localStorage.setItem('user', JSON.stringify(userData));

      setToken(token);
      setUser(userData);
      setIsTempPassword(isTempPassword);
      setLoading(false);

      console.log('[DEBUG Trace Step 1 - AuthContext Login]', {
        role: userData?.role,
        organizationId: userData?.organizationId,
        token: token ? `${token.substring(0, 15)}...` : null
      });

      return { success: true, isTempPassword, user: userData };
    } catch (error) {
      logout();
      setLoading(false);
      const isServerError = !error.response || error.response.status >= 500;
      const msg = error.response?.data?.message || (isServerError ? 'Login failed. Please try again later.' : 'Invalid email or password.');
      return { success: false, message: msg, isServerError, status: error.response?.status };
    }
  };

  const updateProfile = async (formData) => {
    try {
      const res = await api.put('/auth/profile', formData);
      setUser(res.data.user);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      return { success: true, message: res.data.message };
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to update profile.';
      return { success: false, message: msg };
    }
  };

  const removeProfilePicture = async () => {
    try {
      console.log('[AuthContext] Sending DELETE /users/profile-photo request...');
      const res = await api.delete('/users/profile-photo');
      console.log('[AuthContext] DELETE response received:', res.data);
      const updatedUser = {
        ...(user || JSON.parse(localStorage.getItem('user') || '{}')),
        profilePic: null,
        profilePhoto: null,
        profileImage: null,
        avatar: null
      };
      setUser(updatedUser);
      localStorage.setItem('user', JSON.stringify(updatedUser));
      return { success: true, message: res.data?.message || 'Profile photo removed successfully.', user: updatedUser };
    } catch (error) {
      console.error('[AuthContext] DELETE request failed:', error);
      const msg = error.response?.data?.message || error.message || 'Failed to remove profile photo.';
      return { success: false, message: msg };
    }
  };

  const changePassword = async (currentPassword, newPassword) => {
    try {
      await api.put('/auth/change-password', { currentPassword, newPassword });
      setIsTempPassword(false);
      return { success: true, message: 'Password changed successfully.' };
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to change password.';
      return { success: false, message: msg };
    }
  };

  const requestPasswordReset = async (email) => {
    try {
      const res = await api.post('/auth/forgot-password', { email });
      return { success: true, message: res.data.message };
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to send reset link.';
      return { success: false, message: msg };
    }
  };

  const verifyResetOtp = async (email, otp) => {
    try {
      const res = await api.post('/auth/verify-reset-otp', { email, otp });
      return { success: true, message: res.data.message, resetToken: res.data.resetToken };
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to verify OTP.';
      return { success: false, message: msg };
    }
  };

  const resetPasswordWithToken = async (email, resetToken, newPassword, confirmPassword) => {
    try {
      const res = await api.post('/auth/reset-password', { email, resetToken, newPassword, confirmPassword });
      return { success: true, message: res.data.message };
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to reset password.';
      return { success: false, message: msg };
    }
  };

  const completeWelcomePopup = async () => {
    if (!user) return { success: false };
    try {
      const storageKey = `company_welcome_dismissed_${user.id}`;
      localStorage.setItem(storageKey, 'true');

      const updatedUser = { ...user, welcomePopupSeen: true };
      setUser(updatedUser);
      localStorage.setItem('user', JSON.stringify(updatedUser));

      const res = await api.post('/users/me/welcome-complete');
      if (res.data?.user) {
        const freshUser = { ...res.data.user, welcomePopupSeen: true };
        setUser(freshUser);
        localStorage.setItem('user', JSON.stringify(freshUser));
      }
      return { success: true };
    } catch (error) {
      console.warn('Failed to complete welcome popup on server:', error);
      return { success: false };
    }
  };

  const resetWelcomePopup = async (targetUserId) => {
    try {
      const uid = targetUserId || user?.id;
      if (!uid) return { success: false, message: 'User ID required' };
      localStorage.removeItem(`company_welcome_dismissed_${uid}`);

      const res = await api.post(`/admin/users/${uid}/reset-welcome`);
      if (user && user.id === uid) {
        const updatedUser = { ...user, welcomePopupSeen: false };
        setUser(updatedUser);
        localStorage.setItem('user', JSON.stringify(updatedUser));
      }
      return { success: true, message: res.data.message || 'Welcome popup reset.' };
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to reset welcome popup.';
      return { success: false, message: msg };
    }
  };

  const refreshProfile = async () => {
    try {
      const res = await api.get('/auth/profile');
      if (res.data) {
        setUser(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
        return { success: true, user: res.data };
      }
    } catch (profileErr) {
      console.warn('[AuthContext] refreshProfile notice:', profileErr?.message);
      if (profileErr.response && (profileErr.response.status === 401 || profileErr.response.status === 403)) {
        logout();
      }
    }
    return { success: false };
  };

  const value = {
    user,
    setUser,
    token,
    loading,
    isTempPassword,
    organization: user?.organization || null,
    organizationId: user?.organizationId || user?.organization?.id || null,
    organizationSlug: user?.organization?.slug || 'innoveity',
    organizationName: user?.organization?.name || 'INNOVEITY',
    organizationLogo: user?.organization?.logo || null,
    login,
    logout,
    refreshProfile,
    updateProfile,
    removeProfilePicture,
    removeProfilePhoto: removeProfilePicture,
    changePassword,
    requestPasswordReset,
    verifyResetOtp,
    resetPasswordWithToken,
    completeWelcomePopup,
    resetWelcomePopup
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
