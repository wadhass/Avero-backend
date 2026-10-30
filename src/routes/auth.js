import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import User from '../models/User.js'
import authenticate from '../middleware/authenticate.js'
import { asyncHandler, HttpError } from '../utils/errors.js'
import sendEmail from '../utils/sendEmail.js'

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
const verificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many email verification attempts. Please try again later.' },
})
const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many verification code requests. Please try again later.' },
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

function hashResetToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function hashVerificationCode(email, code) {
  return createHmac('sha256', process.env.JWT_SECRET).update(`${email}:${code}`).digest('hex')
}

function verificationCodeMatches(email, code, storedHash) {
  if (typeof storedHash !== 'string' || !/^[a-f0-9]{64}$/.test(storedHash)) return false
  const expected = Buffer.from(storedHash, 'hex')
  const actual = Buffer.from(hashVerificationCode(email, code), 'hex')
  return timingSafeEqual(expected, actual)
}

async function sendVerificationCode(user) {
  const code = String(randomInt(100000, 1000000))
  user.emailVerificationCodeHash = hashVerificationCode(user.email, code)
  user.emailVerificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000)
  await user.save()

  await sendEmail({
    to: user.email,
    subject: 'Verify your Qavero email',
    text: `Hi ${user.name},\n\nYour Qavero verification code is ${code}. It expires in 10 minutes.\n\nIf you did not create a Qavero account, you can ignore this email.`,
  })
}

router.post(
  ['/register', '/signup'],
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
      emailVerified: false,
    })

    await sendVerificationCode(user)
    return res.status(201).json({
      message: 'A verification code has been sent to your email address.',
      email: user.email,
    })
  }),
)

router.post(
  '/verify-email',
  verificationLimiter,
  asyncHandler(async (req, res) => {
    const { email, code } = req.body
    if (
      typeof email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof code !== 'string' ||
      !/^\d{6}$/.test(code)
    ) {
      throw new HttpError(400, 'Enter a valid email address and 6-digit verification code')
    }

    const normalizedEmail = email.trim().toLowerCase()
    const user = await User.findOne({
      email: normalizedEmail,
      emailVerified: false,
      emailVerificationExpiresAt: { $gt: new Date() },
    }).select('+emailVerificationCodeHash +emailVerificationExpiresAt')

    if (
      !user ||
      !verificationCodeMatches(normalizedEmail, code, user.emailVerificationCodeHash)
    ) {
      throw new HttpError(400, 'The verification code is invalid or has expired')
    }

    user.emailVerified = true
    user.emailVerificationCodeHash = undefined
    user.emailVerificationExpiresAt = undefined
    await user.save()

    return res.json({ user: publicUser(user), token: createToken(user.id) })
  }),
)

router.post(
  '/resend-verification',
  resendVerificationLimiter,
  asyncHandler(async (req, res) => {
    const { email } = req.body
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      throw new HttpError(400, 'Enter a valid email address')
    }

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
      emailVerified: false,
    }).select('+emailVerificationCodeHash +emailVerificationExpiresAt')

    if (user) await sendVerificationCode(user)

    return res.json({
      message: 'If an unverified account exists for that email, a new code is on its way.',
    })
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
    if (user.emailVerified === false) {
      throw new HttpError(403, 'Please verify your email address before signing in.')
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

    const user = await User.findOne({ email: email.trim().toLowerCase() })
    if (user) {
      const token = randomBytes(32).toString('hex')
      user.passwordResetTokenHash = hashResetToken(token)
      user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000)
      await user.save()

      const frontendOrigin =
        process.env.CLIENT_ORIGIN?.split(',')[0].trim().replace(/\/+$/, '') || 'http://localhost:5173'
      const resetUrl = `${frontendOrigin}/reset-password/${token}`
      await sendEmail({
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

const resetPasswordHandler = asyncHandler(async (req, res) => {
  const token = req.params.token ?? req.body.token
  const { password } = req.body
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
})

router.post(['/reset-password/:token', '/reset-password'], resetLimiter, resetPasswordHandler)

router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

export default router
