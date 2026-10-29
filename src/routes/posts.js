import { Router } from 'express'
import mongoose from 'mongoose'
import Post from '../models/Post.js'
import authenticate from '../middleware/authenticate.js'
import { mediaTypes, receiveMedia, removeUploadedMedia } from '../middleware/mediaUpload.js'
import { asyncHandler, HttpError } from '../utils/errors.js'

const router = Router()
router.use(authenticate)

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
      const { text = '', imageUrl = '' } = req.body
      if (typeof text !== 'string' || text.trim().length > 5000) {
        throw new HttpError(400, 'Post text must be 5000 characters or fewer')
      }
      if (typeof imageUrl !== 'string' || imageUrl.length > 2048) {
        throw new HttpError(400, 'Image URL must be a valid text value')
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
    res.json({ liked: !alreadyLiked, likesCount: post.likes.length })
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
    res.status(201).json({ comment: post.comments.at(-1) })
  }),
)

export default router
