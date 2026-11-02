import { Router } from 'express'
import mongoose from 'mongoose'
import authenticate from '../middleware/authenticate.js'
import Notification from '../models/Notification.js'
import { asyncHandler, HttpError } from '../utils/errors.js'

const router = Router()
router.use(authenticate)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsedPage = Number.parseInt(req.query.page, 10)
    const page = Number.isSafeInteger(parsedPage) && parsedPage > 0
      ? Math.min(parsedPage, 1000)
      : 1
    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ recipient: req.user.id })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * 20)
        .limit(21)
        .populate('actor', 'name avatar'),
      Notification.countDocuments({ recipient: req.user.id, readAt: null }),
    ])
    res.json({
      notifications: notifications.slice(0, 20),
      unreadCount,
      hasMore: notifications.length > 20,
    })
  }),
)

router.patch(
  '/read-all',
  asyncHandler(async (req, res) => {
    await Notification.updateMany(
      { recipient: req.user.id, readAt: null },
      { $set: { readAt: new Date() } },
    )
    req.app.get('io').to(`user:${req.user.id}`).emit('notification:read-all')
    res.json({ unreadCount: 0 })
  }),
)

router.patch(
  '/:notificationId/read',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.notificationId)) {
      throw new HttpError(400, 'Invalid notification id')
    }
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.notificationId, recipient: req.user.id, readAt: null },
      { $set: { readAt: new Date() } },
      { new: true },
    )
    if (!notification) {
      const existing = await Notification.exists({
        _id: req.params.notificationId,
        recipient: req.user.id,
      })
      if (!existing) throw new HttpError(404, 'Notification not found')
    }
    const unreadCount = await Notification.countDocuments({
      recipient: req.user.id,
      readAt: null,
    })
    res.json({ unreadCount })
  }),
)

export default router
