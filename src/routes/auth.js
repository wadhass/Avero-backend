import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import nodemailer from 'nodemailer'
import User from '../models/User.js'
import authenticate from '../middleware/authenticate.js'
import { asyncHandler, HttpError } from '../utils/errors.js'

const router = Router()
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' },
})
const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many password reset attempts. Please try again later.' },
})
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many password reset attempts. Please try again later.' },
})

function createToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' })
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
  }
}

function createEmailTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env
  const port = Number(SMTP_PORT)
  if (
    !SMTP_HOST ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !SMTP_USER ||
    !SMTP_PASSWORD ||
    !SMTP_FROM
  ) {
    throw new HttpError(503, 'Password reset email is not configured. Set the SMTP_* values in backend/.env.')
  }

  return {
    from: SMTP_FROM,
    transport: nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    }),
  }
}

function hashResetToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

router.post(
  '/signup',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body
    if (
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      name.trim().length < 2 ||
      name.trim().length > 80 ||
      password.length < 8 ||
      password.length > 128
    ) {
      throw new HttpError(400, 'Enter a name and a password of at least 8 characters')
    }

    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new HttpError(400, 'Enter a valid email address')
    }

    const existingUser = await User.findOne({ email: normalizedEmail })
    if (existingUser) {
      throw new HttpError(409, 'An account with that email already exists')
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
    })

    return res.status(201).json({ user: publicUser(user), token: createToken(user.id) })
  }),
)

router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new HttpError(400, 'Email and password are required')
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash')
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, 'Email or password is incorrect')
    }

    return res.json({ user: publicUser(user), token: createToken(user.id) })
  }),
)

router.post(
  '/forgot-password',
  recoveryLimiter,
  asyncHandler(async (req, res) => {
    const { email } = req.body
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      throw new HttpError(400, 'Enter a valid email address')
    }

    const mailer = createEmailTransport()
    const user = await User.findOne({ email: email.trim().toLowerCase() })
    if (user) {
      const token = randomBytes(32).toString('hex')
      user.passwordResetTokenHash = hashResetToken(token)
      user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000)
      await user.save()

      const frontendOrigin =
        process.env.CLIENT_ORIGIN?.split(',')[0].trim().replace(/\/+$/, '') || 'http://localhost:5173'
      const resetUrl = `${frontendOrigin}/reset-password?token=${token}`
      await mailer.transport.sendMail({
        from: mailer.from,
        to: user.email,
        subject: 'Reset your Qavero password',
        text: `Hi ${user.name},\n\nUse the secure link below to reset your Qavero password. This link expires in 30 minutes and can only be used once.\n\n${resetUrl}\n\nIf you didn’t ask to reset your password, you can ignore this email.`,
      })
    }

    return res.json({
      message: 'If an account exists for that email, a password reset link is on its way.',
    })
  }),
)

router.post(
  '/reset-password',
  resetLimiter,
  asyncHandler(async (req, res) => {
    const { token, password } = req.body
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      throw new HttpError(400, 'This password reset link is invalid or has expired')
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      throw new HttpError(400, 'Your password must be between 8 and 128 characters')
    }

    const user = await User.findOne({
      passwordResetTokenHash: hashResetToken(token),
      passwordResetExpiresAt: { $gt: new Date() },
    }).select('+passwordResetTokenHash +passwordResetExpiresAt')
    if (!user) {
      throw new HttpError(400, 'This password reset link is invalid or has expired')
    }

    user.passwordHash = await bcrypt.hash(password, 12)
    user.passwordResetTokenHash = undefined
    user.passwordResetExpiresAt = undefined
    await user.save()

    return res.json({ message: 'Your password has been reset. You can now sign in.' })
  }),
)

router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

export default router
