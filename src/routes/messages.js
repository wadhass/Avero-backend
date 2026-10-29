import { Router } from 'express'
import mongoose from 'mongoose'
import authenticate from '../middleware/authenticate.js'
import Friendship from '../models/Friendship.js'
import Message from '../models/Message.js'
import User from '../models/User.js'
import { asyncHandler, HttpError } from '../utils/errors.js'

const router = Router()
router.use(authenticate)

async function requireFriend(userId, currentUserId) {
  const friendship = await Friendship.findOne({
    status: 'accepted',
    $or: [
      { requester: currentUserId, recipient: userId },
      { requester: userId, recipient: currentUserId },
    ],
  })
  if (!friendship) throw new HttpError(403, 'You can message friends only')
}

router.get(
  '/:userId',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      throw new HttpError(400, 'Invalid user id')
    }
    await requireFriend(req.params.userId, req.user.id)
    const messages = await Message.find({
      $or: [
        { sender: req.user.id, recipient: req.params.userId },
        { sender: req.params.userId, recipient: req.user.id },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(200)
      .populate('sender', 'name avatar')
    res.json({ messages })
  }),
)

router.post(
  '/:userId',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      throw new HttpError(400, 'Invalid user id')
    }
    const { text } = req.body
    if (typeof text !== 'string' || !text.trim() || text.trim().length > 5000) {
      throw new HttpError(400, 'A message must contain between 1 and 5000 characters')
    }
    if (!(await User.exists({ _id: req.params.userId }))) {
      throw new HttpError(404, 'User not found')
    }
    await requireFriend(req.params.userId, req.user.id)
    const message = await Message.create({
      sender: req.user.id,
      recipient: req.params.userId,
      text: text.trim(),
    })
    await message.populate('sender', 'name avatar')
    res.status(201).json({ message })
  }),
)

export default router
