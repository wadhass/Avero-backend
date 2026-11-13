import { Router } from 'express'
import mongoose from 'mongoose'
import Post from '../models/Post.js'
import Follow from '../models/Follow.js'
import authenticate from '../middleware/authenticate.js'
import { mediaTypes, receiveMedia, removeUploadedMedia } from '../middleware/mediaUpload.js'
import { asyncHandler, HttpError } from '../utils/errors.js'
import { createNotification } from '../utils/notifications.js'

const router = Router()
router.use(authenticate)

router.get(
  '/reels',
  asyncHandler(async (req, res) => {
    const parsedPage = Number.parseInt(req.query.page, 10)
    const page = Number.isSafeInteger(parsedPage) && parsedPage > 0
      ? Math.min(parsedPage, 1000)
      : 1
    const feed = typeof req.query.feed === 'string' ? req.query.feed : 'latest'
    if (!['latest', 'for-you', 'following', 'saved'].includes(feed)) {
      throw new HttpError(400, 'Choose a valid Reels feed')
    }

    const userId = new mongoose.Types.ObjectId(req.user.id)
    const filter = { isReel: true, mediaType: 'video' }
    let followingIds = []
    if (feed === 'following' || feed === 'for-you') {
      followingIds = await Follow.distinct('following', { follower: userId })
      if (feed === 'following') filter.author = { $in: followingIds }
    }
    if (feed === 'saved') filter.savedBy = userId

    const pipeline = [{ $match: filter }]
    if (feed === 'for-you') {
      pipeline.push({
        $addFields: {
          recommendationScore: {
            $multiply: [
              {
                $add: [
                  { $size: { $ifNull: ['$likes', []] } },
                  { $multiply: [{ $size: { $ifNull: ['$comments', []] } }, 2] },
                  1,
                ],
              },
              { $cond: [{ $in: ['$author', followingIds] }, 1.5, 1] },
              {
                $divide: [
                  1,
                  {
                    $add: [
                      { $divide: [{ $subtract: [new Date(), '$createdAt'] }, 3600000] },
                      2,
                    ],
                  },
                ],
              },
            ],
          },
        },
      })
    }
    pipeline.push(
      {
        $addFields: {
          isSaved: { $in: [userId, { $ifNull: ['$savedBy', []] }] },
        },
      },
      {
        $sort: feed === 'for-you'
          ? { recommendationScore: -1, createdAt: -1, _id: -1 }
          : { createdAt: -1, _id: -1 },
      },
      { $skip: (page - 1) * 10 },
      { $limit: 10 },
      { $project: { savedBy: 0, recommendationScore: 0 } },
    )
    const posts = await Post.aggregate(pipeline)
    await Post.populate(posts, [
      { path: 'author', select: 'name avatar' },
      { path: 'comments.author', select: 'name avatar' },
    ])
    res.json({
      reels: posts.map((post) => ({
        ...post,
        id: String(post._id),
        comments: (post.comments ?? []).map((comment) => ({
          ...comment,
          id: String(comment._id),
        })),
      })),
    })
  }),
)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const filter = {}
    if (typeof req.query.author === 'string') {
      if (!mongoose.isValidObjectId(req.query.author)) {
        throw new HttpError(400, 'Invalid author id')
      }
      filter.author = req.query.author
    }
    const posts = await Post.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * 20)
      .limit(20)
      .populate('author', 'name avatar')
      .populate('comments.author', 'name avatar')
    res.json({ posts })
  }),
)

router.post(
  '/',
  receiveMedia,
  asyncHandler(async (req, res) => {
    try {
      const { text = '', imageUrl = '', isReel: reelValue = false } = req.body
      const isReel = reelValue === true || reelValue === 'true'
      if (typeof text !== 'string' || text.trim().length > 5000) {
        throw new HttpError(400, 'Post text must be 5000 characters or fewer')
      }
      if (reelValue !== true && reelValue !== false && reelValue !== 'true' && reelValue !== 'false') {
        throw new HttpError(400, 'Reel selection is invalid')
      }
      if (typeof imageUrl !== 'string' || imageUrl.length > 2048) {
        throw new HttpError(400, 'Image URL must be a valid text value')
      }
      if (isReel && (!req.file || mediaTypes.get(req.file.mimetype)?.type !== 'video')) {
        throw new HttpError(400, 'A reel must include an uploaded video')
      }
      if (!text.trim() && !imageUrl.trim() && !req.file) {
        throw new HttpError(400, 'A post must contain text or media')
      }

      const uploadedMedia = req.file ? mediaTypes.get(req.file.mimetype) : null
      const post = await Post.create({
        author: req.user.id,
        text: text.trim(),
        imageUrl: imageUrl.trim(),
        mediaUrl: req.file ? `/uploads/${req.file.filename}` : '',
        mediaType: uploadedMedia?.type ?? '',
        isReel,
      })
      await post.populate('author', 'name avatar')
      res.status(201).json({ post })
    } catch (error) {
      if (req.file) await removeUploadedMedia(`/uploads/${req.file.filename}`)
      throw error
    }
  }),
)

router.delete(
  '/:postId',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.postId)) {
      throw new HttpError(400, 'Invalid post id')
    }
    const post = await Post.findById(req.params.postId)
    if (!post) throw new HttpError(404, 'Post not found')
    if (!post.author.equals(req.user.id)) {
      throw new HttpError(403, 'You can delete only your own posts')
    }

    await post.deleteOne()
    await removeUploadedMedia(post.mediaUrl)
    res.status(204).end()
  }),
)

router.post(
  '/:postId/like',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.postId)) {
      throw new HttpError(400, 'Invalid post id')
    }
    const post = await Post.findById(req.params.postId)
    if (!post) throw new HttpError(404, 'Post not found')

    const alreadyLiked = post.likes.some((id) => id.equals(req.user.id))
    if (alreadyLiked) {
      post.likes.pull(req.user.id)
    } else {
      post.likes.addToSet(req.user.id)
    }
    await post.save()
    if (!alreadyLiked) {
      await createNotification({
        io: req.app.get('io'),
        recipient: post.author,
        actor: req.user.id,
        type: 'like',
        message: 'liked your post',
        resourceId: post.id,
      })
    }
    res.json({ liked: !alreadyLiked, likesCount: post.likes.length })
  }),
)

router.post(
  '/:postId/save',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.postId)) {
      throw new HttpError(400, 'Invalid post id')
    }
    const post = await Post.findById(req.params.postId).select('+savedBy')
    if (!post) throw new HttpError(404, 'Post not found')
    if (!post.isReel) throw new HttpError(400, 'Only Reels can be saved here')

    const alreadySaved = post.savedBy.some((id) => id.equals(req.user.id))
    if (alreadySaved) post.savedBy.pull(req.user.id)
    else post.savedBy.addToSet(req.user.id)
    await post.save()
    res.json({ saved: !alreadySaved })
  }),
)

router.post(
  '/:postId/comments',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.postId)) {
      throw new HttpError(400, 'Invalid post id')
    }
    const { text } = req.body
    if (typeof text !== 'string' || !text.trim() || text.trim().length > 2000) {
      throw new HttpError(400, 'A comment must contain between 1 and 2000 characters')
    }

    const post = await Post.findById(req.params.postId)
    if (!post) throw new HttpError(404, 'Post not found')
    post.comments.push({ author: req.user.id, text: text.trim() })
    await post.save()
    await post.populate('comments.author', 'name avatar')
    await createNotification({
      io: req.app.get('io'),
      recipient: post.author,
      actor: req.user.id,
      type: 'comment',
      message: 'commented on your post',
      resourceId: post.id,
    })
    res.status(201).json({ comment: post.comments.at(-1) })
  }),
)

export default router
