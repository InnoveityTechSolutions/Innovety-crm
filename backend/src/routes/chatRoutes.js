const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../middleware/auth');
const { requireChatEnabled } = require('../middleware/requireChatEnabled');
const { requirePermission } = require('../middleware/permissionMiddleware');
const chatController = require('../controllers/chatController');

// Configure Multer storage for chat uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/chat');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'chat-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max file size
});

// All chat routes require JWT Auth, Feature Access, and VIEW permission on chat
router.use(authenticate);
router.use(requireChatEnabled);
router.use(requirePermission('chat', 'VIEW'));

// Rooms & Conversations
router.get('/rooms', chatController.getRooms);
router.get('/rooms/project/:projectId', chatController.getOrCreateProjectChatRoom);
router.post('/rooms/direct', requirePermission('chat', 'EDIT'), chatController.createDirectRoom);
router.post('/rooms/team', requirePermission('chat', 'EDIT'), chatController.createTeamRoom);
router.delete('/groups/:groupId', requirePermission('chat', 'EDIT'), chatController.deleteGroup);
router.delete('/rooms/:roomId', requirePermission('chat', 'EDIT'), chatController.deleteGroup);

// Messages
router.get('/rooms/:roomId/messages', chatController.getRoomMessages);
router.post('/messages', requirePermission('chat', 'EDIT'), chatController.sendMessage);
router.put('/messages/:messageId', requirePermission('chat', 'EDIT'), chatController.editMessage);
router.delete('/messages/:messageId', requirePermission('chat', 'EDIT'), chatController.softDeleteMessage);
router.put('/messages/:messageId/pin', requirePermission('chat', 'EDIT'), chatController.togglePinMessage);
router.get('/messages/:messageId/download', chatController.downloadAttachment);
router.post('/rooms/:roomId/read', chatController.markRoomAsRead);

// Search
router.get('/search', chatController.searchChat);

// File Attachment Upload Endpoint
router.post('/upload', requirePermission('chat', 'EDIT'), upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file provided.' });
    }

    const attachmentUrl = `/uploads/chat/${req.file.filename}`;
    const fileName = req.file.originalname;
    const fileSize = req.file.size;
    const isImage = req.file.mimetype.startsWith('image/');
    const isVideo = req.file.mimetype.startsWith('video/');
    const isAudio = req.file.mimetype.startsWith('audio/');
    let messageType = 'FILE';
    if (isImage) messageType = 'IMAGE';
    else if (isVideo) messageType = 'VIDEO';
    else if (isAudio) messageType = 'AUDIO';

    res.json({
      attachmentUrl,
      fileName,
      fileSize,
      messageType
    });
  } catch (error) {
    console.error('Chat file upload error:', error);
    res.status(500).json({ message: 'File upload failed.' });
  }
});

module.exports = router;
