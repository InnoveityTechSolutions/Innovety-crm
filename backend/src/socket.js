const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'enterprise_internship_crm_super_secret_jwt_key_123!';

// Dual-index presence stores (Backend Single Source of Truth)
// userId (string) -> { userId: string, name: string, role: string, teamId: string, connectedAt: Date, lastSeen: Date|null, sockets: Set<socketId> }
const onlineUsers = new Map();
// socketId (string) -> userId (string)
const socketToUser = new Map();

let io;

const getOnlineUsersPayload = () => {
  return Array.from(onlineUsers.values()).map(info => ({
    id: String(info.userId),
    userId: String(info.userId),
    name: info.name,
    role: info.role,
    connectedAt: info.connectedAt,
    lastSeen: info.lastSeen
  }));
};

const broadcastOnlineUsers = () => {
  if (!io) return;
  const activeList = getOnlineUsersPayload();
  io.emit('online_users', activeList);
  console.log(`[ONLINE USERS] count: ${onlineUsers.size}`);
};

const removeSocket = (socketId, reason = 'transport_close') => {
  if (!socketToUser.has(socketId)) return;
  const strUserId = socketToUser.get(socketId);
  socketToUser.delete(socketId);

  const userEntry = onlineUsers.get(strUserId);
  if (userEntry) {
    userEntry.sockets.delete(socketId);
    console.log(`[SOCKET DISCONNECT] userId: ${strUserId} | socketId: ${socketId} | remainingSockets: ${userEntry.sockets.size} | reason: ${reason}`);
    
    if (userEntry.sockets.size === 0) {
      userEntry.lastSeen = new Date();
      onlineUsers.delete(strUserId);
      console.log(`[PRESENCE OFFLINE] userId: ${strUserId} | Total Online: ${onlineUsers.size}`);
      if (io) {
        io.emit('user_offline', { id: strUserId, userId: strUserId, lastSeen: userEntry.lastSeen });
        broadcastOnlineUsers();
      }
    }
  }
};

const { corsOriginValidator } = require('./utils/corsConfig');

const init = (server) => {
  io = socketIo(server, {
    cors: {
      origin: corsOriginValidator,
      credentials: true,
      methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
  });

  // Socket.IO Handshake Authentication Middleware
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '') ||
        socket.handshake.query?.token;

      if (!token) {
        console.warn(`[SOCKET AUTH REJECTED] Anonymous connection attempt from socket: ${socket.id}`);
        return next(new Error('Authentication token required for real-time connection'));
      }

      const decoded = jwt.verify(token, JWT_SECRET);
      if (!decoded || !decoded.id) {
        console.warn(`[SOCKET AUTH REJECTED] Invalid token payload from socket: ${socket.id}`);
        return next(new Error('Invalid authentication token'));
      }

      socket.user = decoded;
      socket.userId = String(decoded.id);
      console.log(`[SOCKET AUTH SUCCESS] User: ${socket.userId} (${decoded.name || decoded.role}) [socket: ${socket.id}]`);
      next();
    } catch (err) {
      console.warn(`[SOCKET AUTH ERROR] ${err.message} from socket: ${socket.id}`);
      next(new Error('Authentication failed: ' + err.message));
    }
  });

  io.on('connection', (socket) => {
    const strUserId = String(socket.userId);
    const name = socket.user?.name || 'User';
    const role = socket.user?.role || 'EMPLOYEE';
    const teamId = socket.user?.teamId || null;

    // Disassociate any previous user on this socket ID if it existed
    if (socketToUser.has(socket.id)) {
      const prevUserId = socketToUser.get(socket.id);
      if (prevUserId !== strUserId) {
        const prevEntry = onlineUsers.get(prevUserId);
        if (prevEntry) {
          prevEntry.sockets.delete(socket.id);
          if (prevEntry.sockets.size === 0) {
            onlineUsers.delete(prevUserId);
            io.emit('user_offline', { id: prevUserId, userId: prevUserId, lastSeen: new Date() });
          }
        }
      }
    }

    socketToUser.set(socket.id, strUserId);

    const isFirstSocket = !onlineUsers.has(strUserId);
    const organizationId = socket.user?.organizationId || 'innoveity';

    if (isFirstSocket) {
      onlineUsers.set(strUserId, {
        userId: strUserId,
        name,
        role,
        teamId,
        organizationId,
        connectedAt: new Date(),
        lastSeen: null,
        sockets: new Set([socket.id])
      });
      console.log(`[PRESENCE ONLINE] userId: ${strUserId} (${name}) | Org: ${organizationId} | Total Online: ${onlineUsers.size}`);
      io.to(`org_${organizationId}`).emit('user_online', { id: strUserId, userId: strUserId, name, role, organizationId, connectedAt: new Date() });
    } else {
      const userEntry = onlineUsers.get(strUserId);
      userEntry.sockets.add(socket.id);
      userEntry.name = name || userEntry.name;
      userEntry.role = role || userEntry.role;
      userEntry.organizationId = organizationId || userEntry.organizationId;
      if (teamId) userEntry.teamId = teamId;
    }

    console.log(`[SOCKET CONNECT] userId: ${strUserId} | socketId: ${socket.id} | activeSockets: ${onlineUsers.get(strUserId)?.sockets.size}`);

    // Standard room joins
    socket.join('global');
    socket.join(`org_${organizationId}`);
    socket.join(`user_${strUserId}`);
    if (teamId) socket.join(`team_${teamId}`);
    if (role === 'ADMIN') socket.join('admins');
    else if (role === 'TEAM_LEADER') socket.join('leaders');

    // Helper for sending organization-scoped online users payload
    const sendOnlineUsersToSocket = (targetSocket) => {
      const isSuperAdmin = targetSocket.user?.role === 'SUPER_ADMIN';
      const userOrgId = targetSocket.user?.organizationId;
      const list = Array.from(onlineUsers.values())
        .filter(info => isSuperAdmin || !userOrgId || info.organizationId === userOrgId)
        .map(info => ({
          id: String(info.userId),
          userId: String(info.userId),
          name: info.name,
          role: info.role,
          organizationId: info.organizationId,
          connectedAt: info.connectedAt,
          lastSeen: info.lastSeen
        }));
      targetSocket.emit('online_users', list);
    };

    sendOnlineUsersToSocket(socket);

    // Explicit request to get online users list
    socket.on('get_online_users', () => {
      sendOnlineUsersToSocket(socket);
    });

    // Dynamic register / metadata update
    socket.on('register', (data) => {
      if (data && data.teamId) {
        socket.join(`team_${data.teamId}`);
        const entry = onlineUsers.get(strUserId);
        if (entry) entry.teamId = data.teamId;
      }
      socket.emit('online_users', getOnlineUsersPayload());
    });

    const checkChatEnabledForSocket = async () => {
      if (role === 'SUPER_ADMIN') return true;
      try {
        const prisma = require('./utils/db');
        const platform = await prisma.platformSettings.findUnique({ where: { id: 'PLATFORM' } }).catch(() => null);
        const platformAdmin = platform?.chatEnabledForAdmins ?? true;
        const platformUser = platform?.chatEnabledForUsers ?? true;

        let tenantAdmin = true;
        let tenantUser = true;

        if (organizationId) {
          const orgSettings = await prisma.organizationSettings.findUnique({ where: { organizationId } }).catch(() => null);
          if (orgSettings) {
            tenantAdmin = orgSettings.chatEnabledForAdmins ?? true;
            tenantUser = orgSettings.chatEnabledForUsers ?? true;
          }
        }

        if (role === 'ADMIN') {
          return platformAdmin && tenantAdmin;
        }
        return platformUser && tenantUser;
      } catch (e) {
        return false;
      }
    };

    // ─── CHAT MODULE EVENT HANDLERS ──────────────────────────────
    
    // Join specific chat room (Global, Team, or Direct)
    socket.on('join_chat_room', async (roomId) => {
      const isEnabled = await checkChatEnabledForSocket();
      if (!isEnabled) {
        if (roomId) socket.leave(`chat_room_${roomId}`);
        socket.emit('chat_disabled', {
          type: 'chat_disabled',
          success: false,
          message: 'Chat has been disabled.'
        });
        return;
      }
      if (roomId) {
        socket.join(`chat_room_${roomId}`);
        console.log(`Socket ${socket.id} (user: ${strUserId}) joined chat_room_${roomId}`);
      }
    });

    // Leave specific chat room
    socket.on('leave_chat_room', (roomId) => {
      if (roomId) {
        socket.leave(`chat_room_${roomId}`);
        console.log(`Socket ${socket.id} (user: ${strUserId}) left chat_room_${roomId}`);
      }
    });

    // Real-time chat message dispatch
    socket.on('send_chat_message', async (messageData) => {
      const isEnabled = await checkChatEnabledForSocket();
      if (!isEnabled) {
        if (messageData?.roomId) socket.leave(`chat_room_${messageData.roomId}`);
        socket.emit('chat_disabled', {
          type: 'chat_disabled',
          success: false,
          message: 'Chat has been disabled.'
        });
        return;
      }
      if (messageData && messageData.roomId) {
        console.log(`[MESSAGE SENT] From socket: ${socket.id} | Room: ${messageData.roomId} | MessageId: ${messageData.id}`);
        io.to(`chat_room_${messageData.roomId}`).emit('receive_chat_message', messageData);
        if (messageData.receiverId) {
          io.to(`user_${String(messageData.receiverId)}`).emit('receive_chat_message', messageData);
        }
        io.emit('chat_room_activity', { roomId: messageData.roomId, lastMessage: messageData });
        console.log(`[MESSAGE EMITTED] Dispatched to chat_room_${messageData.roomId} and user_${messageData.receiverId || 'all'}`);
      }
    });

    // Real-time typing indicators
    socket.on('typing', async ({ roomId, userId, userName }) => {
      const isEnabled = await checkChatEnabledForSocket();
      if (!isEnabled) {
        if (roomId) socket.leave(`chat_room_${roomId}`);
        socket.emit('chat_disabled', {
          type: 'chat_disabled',
          success: false,
          message: 'Chat has been disabled.'
        });
        return;
      }
      if (roomId) {
        socket.to(`chat_room_${roomId}`).emit('user_typing', { roomId, userId: userId || strUserId, userName: userName || name });
      }
    });

    socket.on('stop_typing', ({ roomId, userId }) => {
      if (roomId) {
        socket.to(`chat_room_${roomId}`).emit('user_stop_typing', { roomId, userId: userId || strUserId });
      }
    });

    // Real-time message edit / delete events
    socket.on('message_edited', (messageData) => {
      if (messageData && messageData.roomId) {
        io.to(`chat_room_${messageData.roomId}`).emit('message_edited', messageData);
      }
    });

    socket.on('message_deleted', (messageData) => {
      if (messageData && messageData.roomId) {
        io.to(`chat_room_${messageData.roomId}`).emit('message_deleted', messageData);
        io.emit('chat_room_activity', { roomId: messageData.roomId, lastMessage: messageData });
      }
    });

    // Real-time message read receipts
    socket.on('message_read', ({ roomId, userId }) => {
      if (roomId) {
        io.to(`chat_room_${roomId}`).emit('room_messages_read', { roomId, userId: userId || strUserId, readAt: new Date() });
      }
    });

    // Explicit client logout
    socket.on('logout', () => {
      console.log(`[SOCKET EXPLICIT LOGOUT] userId: ${strUserId} | socketId: ${socket.id}`);
      removeSocket(socket.id, 'client_logout');
      socket.disconnect(true);
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      removeSocket(socket.id, reason);
    });
  });

  return io;
};

// Send direct notification to active user
const sendNotificationToUser = (userId, notification) => {
  if (!io || !userId) return;
  const strUserId = String(userId);
  io.to(`user_${strUserId}`).emit('notification', notification);
  const userRecord = onlineUsers.get(strUserId);
  if (userRecord && userRecord.sockets) {
    for (const socketId of userRecord.sockets) {
      io.to(socketId).emit('notification', notification);
    }
  }
};

// Broadcast announcement
const sendAnnouncement = (announcement) => {
  if (!io) return;
  if (announcement.targetTeamId) {
    io.to(`team_${announcement.targetTeamId}`).emit('announcement', announcement);
  } else {
    io.to('global').emit('announcement', announcement);
  }
};

// Disconnect active socket connection for a user
const disconnectUserSocket = (userId) => {
  if (!io || !userId) return;
  const strUserId = String(userId);
  const userRecord = onlineUsers.get(strUserId);
  if (userRecord && userRecord.sockets) {
    for (const socketId of userRecord.sockets) {
      const sock = io.sockets.sockets.get(socketId);
      if (sock) {
        sock.disconnect(true);
      }
      socketToUser.delete(socketId);
    }
  }
  onlineUsers.delete(strUserId);
  broadcastOnlineUsers();
};

// Get list of online user IDs
const getOnlineUsers = () => {
  return Array.from(onlineUsers.keys());
};

// Check if user is online
const isUserOnline = (userId) => {
  if (!userId) return false;
  return onlineUsers.has(String(userId));
};

// Get the io instance
const getIo = () => {
  return io;
};

// Broadcast attendance real-time event
const broadcastAttendanceEvent = (eventName, data) => {
  if (!io) return;
  const payload = {
    ...data,
    organizationId: data?.organizationId || data?.record?.organizationId || data?.user?.organizationId
  };
  if (payload.organizationId) {
    io.to(`org_${payload.organizationId}`).emit(eventName, payload);
  }
  io.emit(eventName, payload);
};

// Broadcast team performance update signal
const broadcastTeamPerformanceUpdate = () => {
  if (!io) return;
  io.emit('team_performance_updated');
};

/**
 * Disconnects all active sockets belonging to a suspended organization (excluding Super Admin).
 * Emits 'organization_suspended' notice before disconnecting sockets.
 */
const disconnectOrganizationSockets = (organizationId) => {
  if (!io || !organizationId) return;

  const roomName = `org_${organizationId}`;
  const roomSockets = io.sockets.adapter.rooms.get(roomName);

  if (roomSockets) {
    for (const socketId of roomSockets) {
      const clientSocket = io.sockets.sockets.get(socketId);
      if (clientSocket && clientSocket.user && clientSocket.user.role !== 'SUPER_ADMIN') {
        clientSocket.emit('organization_suspended', {
          message: 'Your organization has been suspended by system administrator. You have been logged out.'
        });
        clientSocket.disconnect(true);
      }
    }
  }
};

// Broadcast leave policy update real-time event
const broadcastLeavePolicyUpdate = (organizationId, data = {}) => {
  if (!io) return;
  const payload = {
    organizationId,
    updatedAt: new Date().toISOString(),
    ...data
  };
  if (organizationId) {
    io.to(`org_${organizationId}`).emit('organization_leave_policy_updated', payload);
    io.to(`org_${organizationId}`).emit('leave_balance_updated', payload);
  }
  io.emit('organization_leave_policy_updated', payload);
  io.emit('leave_balance_updated', payload);
};

// Broadcast shift update real-time event
const broadcastShiftUpdate = (organizationId, data = {}) => {
  if (!io) return;
  const payload = {
    organizationId,
    timestamp: new Date().toISOString(),
    ...data
  };
  if (organizationId) {
    io.to(`org_${organizationId}`).emit('shift_updated', payload);
    io.to(`org_${organizationId}`).emit('schedule_updated', payload);
  }
  io.emit('shift_updated', payload);
  io.emit('schedule_updated', payload);
};

module.exports = {
  init,
  getIo,
  getIO: getIo,
  sendNotificationToUser,
  sendAnnouncement,
  getOnlineUsers,
  isUserOnline,
  disconnectUserSocket,
  disconnectOrganizationSockets,
  broadcastAttendanceEvent,
  broadcastTeamPerformanceUpdate,
  broadcastLeavePolicyUpdate,
  broadcastShiftUpdate
};
