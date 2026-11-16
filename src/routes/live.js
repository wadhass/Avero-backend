import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'
import authenticate from '../middleware/authenticate.js'
import LiveStream from '../models/LiveStream.js'
import { asyncHandler, HttpError } from '../utils/errors.js'

const router = Router()
const staleStreamMs = 120_000
router.use(authenticate)

function getLiveKitConfig() {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    throw new HttpError(503, 'Live streaming is not configured on the server')
  }

  let url
  try {
    url = new URL(LIVEKIT_URL)
  } catch {
    throw new HttpError(503, 'LIVEKIT_URL must be a valid LiveKit server URL')
  }
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol)) {
    throw new HttpError(503, 'LIVEKIT_URL must use ws, wss, http, or https')
  }

  const clientUrl = new URL(url)
  const serverUrl = new URL(url)
  if (clientUrl.protocol === 'https:') clientUrl.protocol = 'wss:'
  if (clientUrl.protocol === 'http:') clientUrl.protocol = 'ws:'
  if (serverUrl.protocol === 'wss:') serverUrl.protocol = 'https:'
  if (serverUrl.protocol === 'ws:') serverUrl.protocol = 'http:'

  return {
    clientUrl: clientUrl.href,
    roomService: new RoomServiceClient(serverUrl.href, LIVEKIT_API_KEY, LIVEKIT_API_SECRET),
    apiKey: LIVEKIT_API_KEY,
    apiSecret: LIVEKIT_API_SECRET,
  }
}

export async function createLiveKitToken({
  apiKey,
  apiSecret,
  identity,
  name,
  roomName,
  canPublish,
}) {
  const token = new AccessToken(apiKey, apiSecret, {
    identity: String(identity),
    name,
    ttl: '1h',
  })
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish,
    canPublishData: true,
    canSubscribe: true,
  })
  return token.toJwt()
}

async function endStaleStreams() {
  const cutoff = new Date(Date.now() - staleStreamMs)
  await LiveStream.updateMany(
    { status: 'live', lastHeartbeatAt: { $lte: cutoff } },
    { $set: { status: 'ended', endedAt: new Date() } },
  )
}

function toLiveStreamDto(stream, viewerCount = 0) {
  return {
    id: stream.id,
    title: stream.title,
    host: {
      id: stream.host.id,
      name: stream.host.name,
      avatar: stream.host.avatar,
    },
    startedAt: stream.startedAt,
    viewerCount,
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { roomService } = getLiveKitConfig()
    await endStaleStreams()
    const streams = await LiveStream.find({ status: 'live' })
      .sort({ startedAt: -1 })
      .populate('host', 'name avatar')
    const rooms = streams.length
      ? await roomService.listRooms(streams.map((stream) => stream.roomName))
      : []
    const roomByName = new Map(rooms.map((room) => [room.name, room]))

    res.json({
      streams: streams.map((stream) => {
        const room = roomByName.get(stream.roomName)
        const viewerCount = room
          ? Math.max((room.numParticipants ?? 1) - 1, 0)
          : 0
        return toLiveStreamDto(stream, viewerCount)
      }),
    })
  }),
)

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { title } = req.body
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 120) {
      throw new HttpError(400, 'A live title must contain between 1 and 120 characters')
    }

    const config = getLiveKitConfig()
    await endStaleStreams()
    const roomName = `qavero-live-${randomUUID()}`
    await config.roomService.createRoom({
      name: roomName,
      emptyTimeout: 60,
      departureTimeout: 60,
    })

    let stream
    try {
      stream = await LiveStream.create({
        host: req.user.id,
        title: title.trim(),
        roomName,
      })
      const token = await createLiveKitToken({
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
        identity: req.user.id,
        name: req.user.name,
        roomName,
        canPublish: true,
      })
      res.status(201).json({
        stream: toLiveStreamDto({ ...stream.toObject(), id: stream.id, host: req.user }),
        url: config.clientUrl,
        token,
      })
    } catch (error) {
      await config.roomService.deleteRoom(roomName)
      if (stream) await stream.deleteOne()
      throw error
    }
  }),
)

router.post(
  '/:streamId/token',
  asyncHandler(async (req, res) => {
    const config = getLiveKitConfig()
    const stream = await LiveStream.findOne({ _id: req.params.streamId, status: 'live' })
      .populate('host', 'name avatar')
    if (!stream) throw new HttpError(404, 'This live stream is no longer available')

    const isHost = stream.host.id === req.user.id
    const token = await createLiveKitToken({
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      identity: req.user.id,
      name: req.user.name,
      roomName: stream.roomName,
      canPublish: isHost,
    })
    res.json({
      stream: toLiveStreamDto(stream),
      url: config.clientUrl,
      token,
      isHost,
    })
  }),
)

router.post(
  '/:streamId/heartbeat',
  asyncHandler(async (req, res) => {
    const stream = await LiveStream.findOneAndUpdate(
      { _id: req.params.streamId, host: req.user.id, status: 'live' },
      { $set: { lastHeartbeatAt: new Date() } },
      { new: true },
    )
    if (!stream) throw new HttpError(404, 'This live stream is no longer available')
    res.json({ ok: true })
  }),
)

router.post(
  '/:streamId/end',
  asyncHandler(async (req, res) => {
    const { roomService } = getLiveKitConfig()
    const stream = await LiveStream.findOne({
      _id: req.params.streamId,
      host: req.user.id,
      status: 'live',
    })
    if (!stream) throw new HttpError(404, 'This live stream is no longer available')

    await roomService.deleteRoom(stream.roomName)
    stream.status = 'ended'
    stream.endedAt = new Date()
    await stream.save()
    res.json({ ended: true })
  }),
)

export default router
