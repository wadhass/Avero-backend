import { Router } from 'express'
import mongoose from 'mongoose'
import authenticate from '../middleware/authenticate.js'
import Friendship from '../models/Friendship.js'
import User from '../models/User.js'
import { asyncHandler, HttpError } from '../utils/errors.js'

const router = Router()
router.use(authenticate)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const relationships = await Friendship.find({
      $or: [{ requester: req.user.id }, { recipient: req.user.id }],
    })
      .populate('requester', 'name avatar')
      .populate('recipient', 'name avatar')
      .sort({ updatedAt: -1 })

    res.json({
      friends: relationships
        .filter((relationship) => relationship.status === 'accepted')
        .map((relationship) => ({
          ...(relationship.requester.id === req.user.id
            ? relationship.recipient.toObject()
            : relationship.requester.toObject()),
          relationshipId: relationship.id,
        })),
      incoming: relationships
        .filter((relationship) =>
          relationship.status === 'pending' && relationship.recipient.id === req.user.id,
        )
        .map((relationship) => ({
          id: relationship.id,
          user: relationship.requester,
        })),
      outgoing: relationships
        .filter((relationship) =>
          relationship.status === 'pending' && relationship.requester.id === req.user.id,
        )
        .map((relationship) => ({
          id: relationship.id,
          user: relationship.recipient,
        })),
    })
  }),
)

router.get(
  '/discover',
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
    const relationships = await Friendship.find({
      $or: [{ requester: req.user.id }, { recipient: req.user.id }],
    }).select('requester recipient')
    const excludedIds = relationships.flatMap((relationship) => [
      relationship.requester,
      relationship.recipient,
    ])
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const users = await User.find({
      _id: excludedIds.length
        ? { $nin: [req.user.id, ...excludedIds] }
        : { $ne: req.user.id },
      ...(search ? { name: { $regex: escapedSearch.slice(0, 80), $options: 'i' } } : {}),
    })
      .select('name avatar')
      .limit(20)
      .sort({ name: 1 })
    res.json({ users })
  }),
)

router.post(
  '/:userId',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      throw new HttpError(400, 'Invalid user id')
    }
    if (req.params.userId === req.user.id) {
      throw new HttpError(400, 'You cannot send a friend request to yourself')
    }
    if (!(await User.exists({ _id: req.params.userId }))) {
      throw new HttpError(404, 'User not found')
    }

    const prior = await Friendship.findOne({
      $or: [
        { requester: req.user.id, recipient: req.params.userId },
        { requester: req.params.userId, recipient: req.user.id },
      ],
    })
    if (prior) {
      if (prior.status === 'accepted') throw new HttpError(409, 'You are already friends')
      if (prior.recipient.equals(req.user.id)) {
        prior.status = 'accepted'
        await prior.save()
        return res.json({ status: 'accepted' })
      }
      throw new HttpError(409, 'A friend request already exists')
    }

    await Friendship.create({ requester: req.user.id, recipient: req.params.userId })
    return res.status(201).json({ status: 'pending' })
  }),
)

router.patch(
  '/:requestId/accept',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.requestId)) {
      throw new HttpError(400, 'Invalid request id')
    }
    const friendship = await Friendship.findOne({
      _id: req.params.requestId,
      recipient: req.user.id,
      status: 'pending',
    })
    if (!friendship) throw new HttpError(404, 'Friend request not found')
    friendship.status = 'accepted'
    await friendship.save()
    res.json({ status: 'accepted' })
  }),
)

router.delete(
  '/:requestId',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.requestId)) {
      throw new HttpError(400, 'Invalid request id')
    }
    const relationship = await Friendship.findById(req.params.requestId)
    if (
      !relationship ||
      (!relationship.requester.equals(req.user.id) && !relationship.recipient.equals(req.user.id))
    ) {
      throw new HttpError(404, 'Friend request or friendship not found')
    }
    await relationship.deleteOne()
    res.status(204).end()
  }),
)

export default router
