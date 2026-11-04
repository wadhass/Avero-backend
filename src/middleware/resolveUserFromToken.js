import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { getFirebaseProjectId, verifyFirebaseIdToken } from '../config/firebaseAdmin.js'
import { HttpError } from '../utils/errors.js'

async function findOrCreateFirebaseUser(claims) {
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : ''
  if (!claims.uid || !email || claims.email_verified !== true) {
    throw new HttpError(403, 'A verified Firebase email is required')
  }

  let user = await User.findOne({ firebaseUid: claims.uid })
  if (user) return user

  user = await User.findOne({ email })
  if (user) {
    if (user.firebaseUid && user.firebaseUid !== claims.uid) {
      throw new HttpError(409, 'This email is already linked to another Firebase account')
    }

    user.firebaseUid = claims.uid
    user.emailVerified = true
    if (!user.avatar && typeof claims.picture === 'string') user.avatar = claims.picture
    await user.save()
    return user
  }

  const name = typeof claims.name === 'string' && claims.name.trim()
    ? claims.name.trim().slice(0, 80)
    : email.split('@')[0].slice(0, 80)

  try {
    return await User.create({
      name,
      email,
      firebaseUid: claims.uid,
      emailVerified: true,
      ...(typeof claims.picture === 'string' ? { avatar: claims.picture } : {}),
    })
  } catch (error) {
    if (error.code !== 11000) throw error
    const linkedUser = await User.findOne({ firebaseUid: claims.uid })
    if (linkedUser) return linkedUser
    throw error
  }
}

export default async function resolveUserFromToken(token) {
  const claims = jwt.decode(token)

  if (typeof claims?.iss === 'string' && claims.iss.startsWith('https://securetoken.google.com/')) {
    if (getFirebaseProjectId() && claims.iss !== `https://securetoken.google.com/${getFirebaseProjectId()}`) {
      throw new HttpError(401, 'Your Firebase session is invalid or expired')
    }
    let verifiedClaims
    try {
      verifiedClaims = await verifyFirebaseIdToken(token)
    } catch (error) {
      if ([
        'auth/argument-error',
        'auth/id-token-expired',
        'auth/id-token-revoked',
        'auth/invalid-id-token',
        'auth/user-disabled',
      ].includes(error.code)) {
        throw new HttpError(401, 'Your Firebase session is invalid or expired')
      }
      throw error
    }
    return findOrCreateFirebaseUser(verifiedClaims)
  }

  try {
    const { userId } = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(userId)
    if (!user) throw new HttpError(401, 'Account not found')
    return user
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      throw new HttpError(401, 'Your session is invalid or expired')
    }
    throw error
  }
}
