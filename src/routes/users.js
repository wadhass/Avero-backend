import { Router } from 'express'
import mongoose from 'mongoose'
import authenticate from '../middleware/authenticate.js'
import Friendship from '../models/Friendship.js'
import Post from '../models/Post.js'
import User from '../models/User.js'
import { asyncHandler, HttpError } from '../utils/errors.js'

const router = Router()
router.use(authenticate)

router.get(
  '/:userId',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      throw new HttpError(400, 'Invalid user id')
    }
    const user = await User.findById(req.params.userId).select('name avatar')
    if (!user) throw new HttpError(404, 'User not found')

    const friendship = await Friendship.findOne({
      $or: [
        { requester: req.user.id, recipient: req.params.userId },
        { requester: req.params.userId, recipient: req.user.id },
      ],
    })
    const friendStatus = !friendship
      ? 'none'
      : friendship.status === 'accepted'
        ? 'friends'
        : friendship.requester.equals(req.user.id)
          ? 'pending-sent'
          : 'pending-received'

    const posts = await Post.find({ author: user.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('author', 'name avatar')
      .populate('comments.author', 'name avatar')

    res.json({
      user,
      friendStatus,
      requestId: friendship?.id ?? null,
      posts,
    })
  }),
)

export default router
