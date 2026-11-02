import { Router } from 'express'
import mongoose from 'mongoose'
import authenticate from '../middleware/authenticate.js'
import Follow from '../models/Follow.js'
import User from '../models/User.js'
import { asyncHandler, HttpError } from '../utils/errors.js'
import { createNotification } from '../utils/notifications.js'

const router = Router()
router.use(authenticate)

function validateUserId(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new HttpError(400, 'Invalid user id')
  }
}

router.get(
  '/:userId',
  asyncHandler(async (req, res) => {
    validateUserId(req.params.userId)
    if (!(await User.exists({ _id: req.params.userId }))) {
      throw new HttpError(404, 'User not found')
    }

    const [followersCount, followingCount, isFollowing] = await Promise.all([
      Follow.countDocuments({ following: req.params.userId }),
      Follow.countDocuments({ follower: req.params.userId }),
      Follow.exists({ follower: req.user.id, following: req.params.userId }),
    ])
    res.json({ followersCount, followingCount, isFollowing: Boolean(isFollowing) })
  }),
)

router.get(
  '/:userId/:list',
  asyncHandler(async (req, res) => {
    validateUserId(req.params.userId)
    if (!['followers', 'following'].includes(req.params.list)) {
      throw new HttpError(404, 'Connection list not found')
    }
    if (!(await User.exists({ _id: req.params.userId }))) {
      throw new HttpError(404, 'User not found')
    }

    const parsedPage = Number.parseInt(req.query.page, 10)
    const page = Number.isSafeInteger(parsedPage) && parsedPage > 0
      ? Math.min(parsedPage, 1000)
      : 1
    const isFollowers = req.params.list === 'followers'
    const records = await Follow.find(
      isFollowers ? { following: req.params.userId } : { follower: req.params.userId },
    )
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * 20)
      .limit(21)
      .populate(isFollowers ? 'follower' : 'following', 'name avatar')

    const users = records
      .slice(0, 20)
      .map((record) => record[isFollowers ? 'follower' : 'following'])
      .filter(Boolean)

    res.json({ users, hasMore: records.length > 20 })
  }),
)

router.post(
  '/:userId',
  asyncHandler(async (req, res) => {
    validateUserId(req.params.userId)
    if (req.params.userId === req.user.id) {
      throw new HttpError(400, 'You cannot follow yourself')
    }
    if (!(await User.exists({ _id: req.params.userId }))) {
      throw new HttpError(404, 'User not found')
    }

    const result = await Follow.updateOne(
      { follower: req.user.id, following: req.params.userId },
      { $setOnInsert: { follower: req.user.id, following: req.params.userId } },
      { upsert: true },
    )
    if (result.upsertedCount) {
      await createNotification({
        io: req.app.get('io'),
        recipient: req.params.userId,
        actor: req.user.id,
        type: 'follow',
        message: 'started following you',
      })
    }
    const followersCount = await Follow.countDocuments({ following: req.params.userId })
    res.status(result.upsertedCount ? 201 : 200).json({ following: true, followersCount })
  }),
)

router.delete(
  '/:userId',
  asyncHandler(async (req, res) => {
    validateUserId(req.params.userId)
    if (!(await User.exists({ _id: req.params.userId }))) {
      throw new HttpError(404, 'User not found')
    }
    await Follow.deleteOne({ follower: req.user.id, following: req.params.userId })
    const followersCount = await Follow.countDocuments({ following: req.params.userId })
    res.json({ following: false, followersCount })
  }),
)

export default router
