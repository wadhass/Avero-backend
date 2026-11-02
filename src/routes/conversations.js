import { Router } from 'express'
import mongoose from 'mongoose'
import path from 'node:path'
import authenticate from '../middleware/authenticate.js'
import {
  getMessageMediaType,
  messageUploadsDirectory,
  receiveMessageAttachment,
  removeUploadedMessageMedia,
} from '../middleware/mediaUpload.js'
import Conversation from '../models/Conversation.js'
import Friendship from '../models/Friendship.js'
import Message from '../models/Message.js'
import Notification from '../models/Notification.js'
import { asyncHandler, HttpError } from '../utils/errors.js'

const router = Router()
router.use(authenticate)

async function getMembership(conversationId, userId) {
  if (!mongoose.isValidObjectId(conversationId)) {
    throw new HttpError(400, 'Invalid conversation id')
  }
  const conversation = await Conversation.findOne({
    _id: conversationId,
    'members.user': userId,
  })
  if (!conversation) throw new HttpError(404, 'Group conversation not found')
  return conversation
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const conversations = await Conversation.find({ 'members.user': req.user.id })
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate('members.user', 'name avatar')
      .populate({
        path: 'lastMessage',
        select: 'sender text type mediaType createdAt',
        populate: { path: 'sender', select: 'name' },
      })
    res.json({ conversations })
  }),
)

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { title, memberIds } = req.body
    if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 80) {
      throw new HttpError(400, 'Group name must contain between 2 and 80 characters')
    }
    if (!Array.isArray(memberIds) || memberIds.length < 2 || memberIds.length > 19) {
      throw new HttpError(400, 'Choose between 2 and 19 different friends for your group')
    }
    const normalizedMemberIds = memberIds.map((id) => (
      typeof id === 'string' ? id.toLowerCase() : ''
    ))
    if (
      normalizedMemberIds.some((id) => (
        !mongoose.isValidObjectId(id) || id === req.user.id.toLowerCase()
      )) ||
      new Set(normalizedMemberIds).size !== normalizedMemberIds.length
    ) {
      throw new HttpError(400, 'Choose between 2 and 19 different friends for your group')
    }

    const friendships = await Friendship.find({
      status: 'accepted',
      $or: [
        { requester: req.user.id, recipient: { $in: normalizedMemberIds } },
        { recipient: req.user.id, requester: { $in: normalizedMemberIds } },
      ],
    }).select('requester recipient')
    const acceptedFriendIds = new Set(friendships.map((friendship) => (
      friendship.requester.equals(req.user.id)
        ? String(friendship.recipient)
        : String(friendship.requester)
    )))
    if (normalizedMemberIds.some((id) => !acceptedFriendIds.has(id))) {
      throw new HttpError(403, 'Group conversations can include accepted friends only')
    }

    const conversation = await Conversation.create({
      title: title.trim(),
      owner: req.user.id,
      members: [
        { user: req.user.id, role: 'owner' },
        ...normalizedMemberIds.map((user) => ({ user, role: 'member' })),
      ],
    })
    await conversation.populate('members.user', 'name avatar')
    res.status(201).json({ conversation })
  }),
)

router.get(
  '/:conversationId/messages',
  asyncHandler(async (req, res) => {
    const conversation = await getMembership(req.params.conversationId, req.user.id)
    const messages = await Message.find({ conversation: conversation.id })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('sender', 'name avatar')
    const readMessageIds = messages
      .filter((message) => (
        message.sender.id !== req.user.id &&
        !message.readBy.some((reader) => String(reader) === req.user.id)
      ))
      .map((message) => message.id)
    if (readMessageIds.length) {
      await Message.updateMany(
        { _id: { $in: readMessageIds } },
        { $addToSet: { readBy: req.user.id } },
      )
      for (const message of messages) {
        if (readMessageIds.includes(message.id)) message.readBy.addToSet(req.user.id)
      }
      const readNotifications = await Notification.updateMany(
        {
          recipient: req.user.id,
          type: 'message',
          conversationId: conversation.id,
          resourceId: { $in: readMessageIds.map(String) },
          readAt: null,
        },
        { $set: { readAt: new Date() } },
      )
      req.app.get('io').to(`conversation:${conversation.id}`).emit('conversation:read', {
        conversationId: conversation.id,
        userId: req.user.id,
        messageIds: readMessageIds,
      })
      req.app.get('io').to(`user:${req.user.id}`).emit('notification:read-count', {
        conversationId: conversation.id,
        count: readNotifications.modifiedCount,
      })
    }

    messages.reverse()
    await conversation.populate('members.user', 'name avatar')
    res.json({ conversation, messages })
  }),
)

router.post(
  '/:conversationId/messages',
  asyncHandler(async (req, res, next) => {
    const conversation = await getMembership(req.params.conversationId, req.user.id)
    req.conversation = conversation
    return receiveMessageAttachment(req, res, next)
  }),
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
        conversation: req.conversation.id,
        sender: req.user.id,
        readBy: [req.user.id],
        text: text.trim(),
        type: mediaType?.type ?? 'text',
        mediaType: mediaType?.type ?? '',
        mediaUrl: req.file ? `/api/messages/media/${req.file.filename}` : '',
        fileName: req.file ? path.basename(req.file.originalname).slice(0, 120) : '',
        fileSize: req.file?.size ?? 0,
      })
      req.conversation.lastMessage = message.id
      await req.conversation.save()
      const deliveredMessage = await req.app.get('io').deliverGroupMessage(message)
      res.status(201).json({ message: deliveredMessage })
    } catch (error) {
      if (req.file) {
        await removeUploadedMessageMedia(`/api/messages/media/${req.file.filename}`)
      }
      throw error
    }
  }),
)

router.get(
  '/:conversationId',
  asyncHandler(async (req, res) => {
    const conversation = await getMembership(req.params.conversationId, req.user.id)
    await conversation.populate('members.user', 'name avatar')
    await conversation.populate({
      path: 'lastMessage',
      select: 'sender text type mediaType createdAt',
      populate: { path: 'sender', select: 'name' },
    })
    res.json({ conversation })
  }),
)

export default router
