import { Router } from 'express'
import mongoose from 'mongoose'
import authenticate from '../middleware/authenticate.js'
import { mediaTypes, receiveMedia, removeUploadedMedia } from '../middleware/mediaUpload.js'
import Friendship from '../models/Friendship.js'
import Story from '../models/Story.js'
import { asyncHandler, HttpError } from '../utils/errors.js'

const router = Router()
router.use(authenticate)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const friendships = await Friendship.find({
      status: 'accepted',
      $or: [{ requester: req.user.id }, { recipient: req.user.id }],
    }).select('requester recipient')
    const visibleAuthorIds = [
      req.user.id,
      ...friendships.map((friendship) => (
        friendship.requester.equals(req.user.id) ? friendship.recipient : friendship.requester
      )),
    ]
    const expiredStories = await Story.find({ expiresAt: { $lte: new Date() } }).select('mediaUrl')
    await Promise.all(expiredStories.map((story) => removeUploadedMedia(story.mediaUrl)))
    if (expiredStories.length) {
      await Story.deleteMany({ _id: { $in: expiredStories.map((story) => story.id) } })
    }

    const stories = await Story.find({
      author: { $in: visibleAuthorIds },
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: -1 })
      .populate('author', 'name avatar')
    res.json({ stories })
  }),
)

router.post(
  '/',
  receiveMedia,
  asyncHandler(async (req, res) => {
    try {
      if (!req.file) throw new HttpError(400, 'Choose a photo or video for your story')
      const text = req.body.text ?? ''
      if (typeof text !== 'string' || text.trim().length > 500) {
        throw new HttpError(400, 'Story text must be 500 characters or fewer')
      }
      const mediaType = mediaTypes.get(req.file.mimetype)
      const story = await Story.create({
        author: req.user.id,
        mediaUrl: `/uploads/${req.file.filename}`,
        mediaType: mediaType.type,
        text: text.trim(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      await story.populate('author', 'name avatar')
      res.status(201).json({ story })
    } catch (error) {
      if (req.file) await removeUploadedMedia(`/uploads/${req.file.filename}`)
      throw error
    }
  }),
)

router.delete(
  '/:storyId',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.storyId)) {
      throw new HttpError(400, 'Invalid story id')
    }
    const story = await Story.findById(req.params.storyId)
    if (!story) throw new HttpError(404, 'Story not found')
    if (!story.author.equals(req.user.id)) {
      throw new HttpError(403, 'You can delete only your own stories')
    }

    await story.deleteOne()
    await removeUploadedMedia(story.mediaUrl)
    res.status(204).end()
  }),
)

export default router
