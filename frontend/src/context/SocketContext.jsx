import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import api, { getSocket, disconnectSocket } from '../services/api';

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const { user, token, refreshProfile } = useAuth();
  const [socket, setSocket] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch initial notifications and announcements
  useEffect(() => {
    if (!token) {
      setNotifications([]);
      setAnnouncements([]);
      setOnlineUsers([]);
      setUnreadCount(0);
      return;
    }

    const fetchInitialData = async () => {
      try {
        const [notifRes, announceRes] = await Promise.all([
          api.get('/notifications'),
          api.get('/announcements')
        ]);
        setNotifications(notifRes.data);
        setUnreadCount(notifRes.data.filter((n) => !n.isRead).length);
        setAnnouncements(announceRes.data);
      } catch (error) {
        console.error('Failed to load initial notifications/announcements:', error);
      }
    };

    fetchInitialData();
  }, [token]);

  // Handle live socket connections using ONE shared socket instance
  useEffect(() => {
    if (!user || !token) {
      setOnlineUsers([]);
      setSocket(null);
      disconnectSocket();
      return;
    }

    const sharedSocket = getSocket();
    if (!sharedSocket) return;
    setSocket(sharedSocket);

    const handleRegister = () => {
      const teamId = user.teamMembers?.[0]?.teamId || null;
      sharedSocket.emit('register', {
        userId: user.id,
        name: user.name,
        role: user.role,
        teamId
      });
      sharedSocket.emit('get_online_users');
    };

    if (sharedSocket.connected) {
      handleRegister();
    }

    sharedSocket.on('connect', handleRegister);

    // Listen for new notifications
    const handleNotification = (newNotif) => {
      setNotifications((prev) => [newNotif, ...prev]);
      setUnreadCount((prev) => prev + 1);

      try {
        const audio = new Audio('/notification.mp3');
        audio.volume = 0.5;
        audio.play().catch(() => { });
      } catch (e) { }
    };

    // Listen for live announcements
    const handleAnnouncement = (newAnnounce) => {
      setAnnouncements((prev) => [newAnnounce, ...prev]);
    };

    // Presence: Synchronize bulk list
    const handleOnlineUsers = (usersList) => {
      console.log('[CLIENT RECEIVED] online_users:', usersList);
      if (Array.isArray(usersList)) {
        setOnlineUsers(usersList);
      }
    };

    // Presence: Single user online
    const handleUserOnline = (userObj) => {
      console.log('[CLIENT RECEIVED] user_online:', userObj);
      if (!userObj) return;
      const idStr = String(userObj.userId || userObj.id || '');
      if (!idStr) return;
      setOnlineUsers((prev) => {
        if (prev.some((u) => String(u.userId || u.id) === idStr)) return prev;
        return [...prev, { id: idStr, userId: idStr, name: userObj.name, role: userObj.role }];
      });
    };

    // Presence: Single user offline
    const handleUserOffline = (userObj) => {
      console.log('[CLIENT RECEIVED] user_offline:', userObj);
      if (!userObj) return;
      const idStr = String(userObj.userId || userObj.id || '');
      if (!idStr) return;
      setOnlineUsers((prev) => prev.filter((u) => String(u.userId || u.id) !== idStr));
    };

    // Phase 4: Dynamic Role-Based Access Management permission cache invalidation
    const handleAccessTemplateUpdated = (data) => {
      console.log('[CLIENT RECEIVED] access_template_updated:', data);
      if (!data || !user) return;
      const isAssigned = user.accessTemplateId && (String(user.accessTemplateId) === String(data.templateId));
      const matchesOrg = data.organizationId && user.organizationId && (String(user.organizationId) === String(data.organizationId));
      const matchesUser = data.userId && (String(user.id) === String(data.userId));

      if (isAssigned || matchesUser || (matchesOrg && !user.accessTemplateId)) {
        console.log('[SocketContext] Permissions invalidated by access_template_updated. Refreshing profile...');
        if (typeof refreshProfile === 'function') {
          refreshProfile();
        }
      }
    };

    const handleAccessTemplateDeleted = (data) => {
      console.log('[CLIENT RECEIVED] access_template_deleted:', data);
      if (!data || !user) return;
      if (user.accessTemplateId && String(user.accessTemplateId) === String(data.templateId)) {
        console.log('[SocketContext] Assigned template deleted. Refreshing profile...');
        if (typeof refreshProfile === 'function') {
          refreshProfile();
        }
      }
    };

    const handleUserPermissionsUpdated = (data) => {
      console.log('[CLIENT RECEIVED] user_permissions_updated:', data);
      if (!data || !user) return;
      if (!data.userId || String(data.userId) === String(user.id)) {
        console.log('[SocketContext] Direct user permissions updated. Refreshing profile...');
        if (typeof refreshProfile === 'function') {
          refreshProfile();
        }
      }
    };

    sharedSocket.off('notification', handleNotification);
    sharedSocket.off('announcement', handleAnnouncement);
    sharedSocket.off('online_users', handleOnlineUsers);
    sharedSocket.off('user_online', handleUserOnline);
    sharedSocket.off('user_offline', handleUserOffline);
    sharedSocket.off('access_template_updated', handleAccessTemplateUpdated);
    sharedSocket.off('access_template_deleted', handleAccessTemplateDeleted);
    sharedSocket.off('user_permissions_updated', handleUserPermissionsUpdated);

    sharedSocket.on('notification', handleNotification);
    sharedSocket.on('announcement', handleAnnouncement);
    sharedSocket.on('online_users', handleOnlineUsers);
    sharedSocket.on('user_online', handleUserOnline);
    sharedSocket.on('user_offline', handleUserOffline);
    sharedSocket.on('access_template_updated', handleAccessTemplateUpdated);
    sharedSocket.on('access_template_deleted', handleAccessTemplateDeleted);
    sharedSocket.on('user_permissions_updated', handleUserPermissionsUpdated);

    // Initial fetch of online users
    sharedSocket.emit('get_online_users');

    return () => {
      sharedSocket.off('connect', handleRegister);
      sharedSocket.off('notification', handleNotification);
      sharedSocket.off('announcement', handleAnnouncement);
      sharedSocket.off('online_users', handleOnlineUsers);
      sharedSocket.off('user_online', handleUserOnline);
      sharedSocket.off('user_offline', handleUserOffline);
      sharedSocket.off('access_template_updated', handleAccessTemplateUpdated);
      sharedSocket.off('access_template_deleted', handleAccessTemplateDeleted);
      sharedSocket.off('user_permissions_updated', handleUserPermissionsUpdated);
    };
  }, [user, token, refreshProfile]);

  const markRead = async (id) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Failed to mark notification read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      await api.put('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all notifications read:', error);
    }
  };

  const deleteNotification = async (id) => {
    try {
      await api.delete(`/notifications/${id}`);
      const wasUnread = !notifications.find((n) => n.id === id)?.isRead;
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (wasUnread) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('Failed to delete notification:', error);
    }
  };

  const clearAllNotifications = async () => {
    try {
      await api.delete('/notifications/clear-all');
      setNotifications([]);
      setUnreadCount(0);
    } catch (error) {
      console.error('Failed to clear all notifications:', error);
      setNotifications([]);
      setUnreadCount(0);
    }
  };

  const isUserOnline = useCallback((userId) => {
    if (!userId) return false;
    const targetStr = String(userId);
    return onlineUsers.some((u) => String(u?.userId || u?.id) === targetStr);
  }, [onlineUsers]);

  const value = {
    notifications,
    announcements,
    unreadCount,
    onlineUsers,
    markRead,
    markAllAsRead,
    deleteNotification,
    clearAllNotifications,
    isUserOnline
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};
