import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import connectDatabase from './config/database.js'
import { uploadsDirectory } from './middleware/mediaUpload.js'
import authRoutes from './routes/auth.js'
import friendRoutes from './routes/friends.js'
import messageRoutes from './routes/messages.js'
import postRoutes from './routes/posts.js'
import storyRoutes from './routes/stories.js'
import userRoutes from './routes/users.js'

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to at least 32 characters')
}

const app = express()
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN?.split(',').map((origin) => origin.trim()) ?? false,
  }),
)
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use('/uploads', express.static(uploadsDirectory, { dotfiles: 'deny', index: false }))
app.use('/api/auth', authRoutes)
app.use('/api/posts', postRoutes)
app.use('/api/stories', storyRoutes)
app.use('/api/friends', friendRoutes)
app.use('/api/messages', messageRoutes)
app.use('/api/users', userRoutes)

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' })
})

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error)

  if (error.code === 11000) {
    const message = error.keyPattern?.email
      ? 'An account with that email already exists'
      : 'That relationship already exists'
    return res.status(409).json({ message })
  }
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return res.status(400).json({ message: 'The submitted data is invalid' })
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body must contain valid JSON' })
  }

  console.error(error)
  return res.status(error.status ?? 500).json({
    message: error.status ? error.message : 'An unexpected server error occurred',
  })
})

const port = Number(process.env.PORT) || 5000
await connectDatabase()
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
})
