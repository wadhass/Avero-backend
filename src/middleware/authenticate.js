import jwt from 'jsonwebtoken'
import User from '../models/User.js'

export default async function authenticate(req, res, next) {
  const authorization = req.get('authorization')
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''

  if (!token) {
    return res.status(401).json({ message: 'Sign in to continue' })
  }

  try {
    const { userId } = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(userId)

    if (!user) {
      return res.status(401).json({ message: 'Account not found' })
    }

    req.user = user
    return next()
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Your session is invalid or expired' })
    }

    return next(error)
  }
}
