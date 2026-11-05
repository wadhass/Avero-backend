import { Router } from 'express'
import mongoose from 'mongoose'
import path from 'node:path'
import authenticate from '../middleware/authenticate.js'
import {
  getMessageMediaType,
  getMessageMediaContentType,
  messageUploadsDirectory,
  receiveMessageAttachment,
  removeUploadedMessageMedia,
} from '../middleware/mediaUpload.js'
import Conversation from '../models/Conversation.js'
import Friendship from '../models/Friendship.js'
import Message from '../models/Message.js'
import Notification from '../models/Notification.js'
import User from '../models/User.js'
import { asyncHandler, HttpError } from '../utils/errors.js'

const router = Router()
router.use(authenticate)

router.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const conversationIds = await Conversation.find({ 'members.user': req.user.id }).distinct('_id')
    const [directUnread, groupUnread] = await Promise.all([
      Message.countDocuments({ recipient: req.user.id, readAt: null }),
      Message.countDocuments({
        conversation: { $in: conversationIds },
        sender: { $ne: req.user.id },
        readBy: { $ne: req.user.id },
      }),
    ])
    res.json({ unreadCount: directUnread + groupUnread })
  }),
)

router.get(
  '/media/:filename',
  asyncHandler(async (req, res, next) => {
    const { filename } = req.params
    if (!/^[\da-f-]{36}\.(jpg|png|gif|webp|avif|mp4|webm|mov|ogg|mp3|m4a|wav|aac|pdf|txt)$/.test(filename)) {
      throw new HttpError(404, 'Message attachment not found')
    }
    const mediaUrl = `/api/messages/media/${filename}`
    const message = await Message.findOne({
      mediaUrl,
      $or: [{ sender: req.user.id }, { recipient: req.user.id }],
    }).select('sender recipient conversation mediaType')
    if (!message) throw new HttpError(404, 'Message attachment not found')
    if (message.conversation) {
      const membership = await Conversation.exists({
        _id: message.conversation,
        'members.user': req.user.id,
      })
      if (!membership) throw new HttpError(404, 'Message attachment not found')
      res.type(getMessageMediaContentType(message.mediaType, filename) ?? path.extname(filename))
      res.set('Content-Disposition', 'inline')
      res.sendFile(filename, { root: messageUploadsDirectory }, (error) => {
        if (error) next(error)
      })
      return
    }
    const otherUserId = message.sender.equals(req.user.id) ? message.recipient : message.sender
    await requireConnection(otherUserId, req.user.id)

    res.type(getMessageMediaContentType(message.mediaType, filename) ?? path.extname(filename))
    res.set('Content-Disposition', 'inline')
    res.sendFile(filename, { root: messageUploadsDirectory }, (error) => {
      if (error) next(error)
    })
  }),
)

async function requireConnection(userId, currentUserId) {
  const friendship = await Friendship.findOne({
    status: { $in: ['pending', 'accepted'] },
    $or: [
      { requester: currentUserId, recipient: userId },
      { requester: userId, recipient: currentUserId },
    ],
  })
  if (!friendship) {
    throw new HttpError(403, 'You can message people with an active friend request or accepted friendship only')
  }
}

const validateMessageRecipient = asyncHandler(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.userId)) {
    throw new HttpError(400, 'Invalid user id')
  }
  if (!(await User.exists({ _id: req.params.userId }))) {
    throw new HttpError(404, 'User not found')
  }
  await requireConnection(req.params.userId, req.user.id)
  next()
})

router.get(
  '/:userId',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      throw new HttpError(400, 'Invalid user id')
    }
    await requireConnection(req.params.userId, req.user.id)
    const readAt = new Date()
    const unreadMessages = await Message.find({
      sender: req.params.userId,
      recipient: req.user.id,
      readAt: null,
    }).select('_id sender')
    if (unreadMessages.length) {
      const readMessages = await Message.updateMany(
        { _id: { $in: unreadMessages.map((message) => message.id) } },
        { $set: { readAt } },
      )
      for (const message of unreadMessages) {
        req.app.get('io').to(`user:${message.sender}`).emit('message:status', {
          messageId: message.id,
          readAt,
        })
      }
      req.app.get('io').to(`user:${req.user.id}`).emit('messages:read', {
        friendId: req.params.userId,
        count: readMessages.modifiedCount,
      })
      const readNotifications = await Notification.updateMany(
        {
          recipient: req.user.id,
          actor: req.params.userId,
          type: 'message',
          conversationId: null,
          readAt: null,
        },
        { $set: { readAt } },
      )
      req.app.get('io').to(`user:${req.user.id}`).emit('notification:messages-read', {
        actorId: req.params.userId,
        count: readNotifications.modifiedCount,
      })
    }
    const messages = await Message.find({
      $or: [
        { sender: req.user.id, recipient: req.params.userId },
        { sender: req.params.userId, recipient: req.user.id },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('sender', 'name avatar')
    messages.reverse()
    res.json({ messages })
  }),
)

router.post(
  '/:userId',
  validateMessageRecipient,
  receiveMessageAttachment,
  asyncHandler(async (req, res) => {
    try {
      const { text = '' } = req.body
      if (typeof text !== 'string' || text.trim().length > 5000) {
        throw new HttpError(400, 'Message text must be 5000 characters or fewer')
      }
      if (!text.trim() && !req.file) {
        throw new HttpError(400, 'A message must contain text or an attachment')
      }
      const mediaType = req.file ? getMessageMediaType(req.file.mimetype) : null
      const message = await Message.create({
        sender: req.user.id,
        recipient: req.params.userId,
        text: text.trim(),
        type: mediaType?.type ?? 'text',
        mediaType: mediaType?.type ?? '',
        mediaUrl: req.file ? `/api/messages/media/${req.file.filename}` : '',
        fileName: req.file ? path.basename(req.file.originalname).slice(0, 120) : '',
        fileSize: req.file?.size ?? 0,
      })
      const deliveredMessage = await req.app.get('io').deliverMessage(message)
      res.status(201).json({ message: deliveredMessage })
    } catch (error) {
      if (req.file) {
        await removeUploadedMessageMedia(`/api/messages/media/${req.file.filename}`)
      }
      throw error
    }
  }),
)

export default router
