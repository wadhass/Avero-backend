import { createHmac } from 'node:crypto'
import { Router } from 'express'
import authenticate from '../middleware/authenticate.js'
import CallSession from '../models/CallSession.js'
import { asyncHandler, HttpError } from '../utils/errors.js'

const router = Router()
router.use(authenticate)

export function buildIceServers({ stunUrls, turnUrls, sharedSecret, ttlSeconds }, userId, now = Date.now()) {
  const validStunUrls = stunUrls.filter((url) => /^(stun|stuns):[^,\s]+$/i.test(url))
  const validTurnUrls = turnUrls.filter((url) => /^(turn|turns):[^,\s]+$/i.test(url))
  if (validStunUrls.length !== stunUrls.length || validTurnUrls.length !== turnUrls.length) {
    throw new HttpError(503, 'STUN_URLS and TURN_URLS must contain valid ICE server URLs')
  }
  if (!validStunUrls.length && !validTurnUrls.length) {
    throw new HttpError(503, 'Configure at least one STUN or TURN server')
  }

  const iceServers = []
  if (validStunUrls.length) iceServers.push({ urls: validStunUrls })

  if (validTurnUrls.length) {
    if (!sharedSecret?.trim()) {
      throw new HttpError(503, 'TURN_URLS requires TURN_SHARED_SECRET configuration')
    }
    const ttl = ttlSeconds === undefined || ttlSeconds === ''
      ? 3600
      : Number(ttlSeconds)
    if (!Number.isSafeInteger(ttl) || ttl < 600 || ttl > 86400) {
      throw new HttpError(503, 'TURN_TTL_SECONDS must be between 600 and 86400')
    }
    const username = `${Math.floor(now / 1000) + ttl}:${userId}`
    const credential = createHmac('sha1', sharedSecret).update(username).digest('base64')
    iceServers.push({ urls: validTurnUrls, username, credential })
  }

  return iceServers
}

router.get(
  '/ice-servers',
  (req, res, next) => {
    const stunUrls = (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean)
    const turnUrls = (process.env.TURN_URLS ?? '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean)
    try {
      return res.json({
        iceServers: buildIceServers({
          stunUrls,
          turnUrls,
          sharedSecret: process.env.TURN_SHARED_SECRET,
          ttlSeconds: process.env.TURN_TTL_SECONDS,
        }, req.user.id),
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const calls = await CallSession.find({
      $or: [{ caller: req.user.id }, { recipient: req.user.id }],
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('caller', 'name avatar')
      .populate('recipient', 'name avatar')
    res.json({
      calls: calls.map((call) => ({
        id: call.id,
        caller: call.caller
          ? { id: call.caller.id, name: call.caller.name, avatar: call.caller.avatar }
          : null,
        recipient: call.recipient
          ? { id: call.recipient.id, name: call.recipient.name, avatar: call.recipient.avatar }
          : null,
        kind: call.kind,
        status: call.status,
        startedAt: call.startedAt,
        answeredAt: call.answeredAt,
        endedAt: call.endedAt,
        createdAt: call.createdAt,
        durationSeconds: call.answeredAt && call.endedAt
          ? Math.floor((call.endedAt - call.answeredAt) / 1000)
          : 0,
      })),
    })
  }),
)

export default router
