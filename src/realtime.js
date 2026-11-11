import { Server } from 'socket.io'
import CallSession from './models/CallSession.js'
import Conversation from './models/Conversation.js'
import Friendship from './models/Friendship.js'
import Message from './models/Message.js'
import User from './models/User.js'
import resolveUserFromToken from './middleware/resolveUserFromToken.js'
import { createNotification } from './utils/notifications.js'

export default function createRealtimeServer(httpServer, origins) {
  const io = new Server(httpServer, {
    cors: { origin: origins },
  })
  const connectedUsers = new Map()
  const activeCallsByUser = new Map()
  const ringingTimers = new Map()

  function reserveCall(call) {
    for (const userId of [String(call.caller), String(call.recipient)]) {
      const calls = activeCallsByUser.get(userId) ?? new Set()
      calls.add(call.id)
      activeCallsByUser.set(userId, calls)
    }
  }

  function releaseCall(call) {
    ringingTimers.get(call.id)?.clearTimeout()
    ringingTimers.delete(call.id)
    for (const userId of [String(call.caller), String(call.recipient)]) {
      const calls = activeCallsByUser.get(userId)
      calls?.delete(call.id)
      if (!calls?.size) activeCallsByUser.delete(userId)
    }
  }

  async function notifyMissedCall(call) {
    await createNotification({
      io,
      recipient: call.recipient,
      actor: call.caller,
      type: 'call',
      message: 'tried to call you',
      resourceId: call.id,
    })
  }

  async function getFriendIds(userId) {
    const friendships = await Friendship.find({
      status: 'accepted',
      $or: [{ requester: userId }, { recipient: userId }],
    }).select('requester recipient').lean()

    return friendships.map(({ requester, recipient }) => (
      String(requester) === userId ? String(recipient) : String(requester)
    ))
  }

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
      if (typeof token !== 'string' || !token) {
        return next(new Error('Sign in to connect'))
      }
      const user = await resolveUserFromToken(token)
      socket.data.userId = user.id
      return next()
    } catch (error) {
      if (error.status) {
        return next(new Error(error.message))
      }
      return next(error)
    }
  })

  io.on('connection', (socket) => {
    const userId = socket.data.userId
    const sockets = connectedUsers.get(userId) ?? new Set()
    sockets.add(socket.id)
    connectedUsers.set(userId, sockets)
    socket.join(`user:${userId}`)
    getFriendIds(userId)
      .then((friendIds) => {
        socket.emit('presence:state', {
          onlineUserIds: friendIds.filter((friendId) => connectedUsers.get(friendId)?.size),
        })
        if (sockets.size === 1) {
          friendIds.forEach((friendId) => {
            io.to(`user:${friendId}`).emit('presence:update', { userId, online: true })
          })
        }
      })
      .catch((error) => console.error('Unable to broadcast online presence', error))

    socket.on('call:start', async (payload = {}, acknowledge) => {
      if (typeof acknowledge !== 'function') return
      const { recipientId, kind } = payload
      if (
        typeof recipientId !== 'string' ||
        !/^[a-f\d]{24}$/i.test(recipientId) ||
        recipientId === userId ||
        !['audio', 'video'].includes(kind)
      ) {
        acknowledge({ error: 'Choose a friend and a valid call type' })
        return
      }
      if (activeCallsByUser.has(userId) || activeCallsByUser.has(recipientId)) {
        acknowledge({ error: 'One of you is already in a call' })
        return
      }
      try {
        const [friendship, recipient] = await Promise.all([
          Friendship.exists({
            status: 'accepted',
            $or: [
              { requester: userId, recipient: recipientId },
              { requester: recipientId, recipient: userId },
            ],
          }),
          User.findById(recipientId).select('name avatar'),
        ])
        if (!recipient) {
          acknowledge({ error: 'User not found' })
          return
        }
        if (!friendship) {
          acknowledge({ error: 'You can call accepted friends only' })
          return
        }
        const caller = await User.findById(userId).select('name avatar')
        let call = await CallSession.create({
          caller: userId,
          recipient: recipientId,
          kind,
        })
        if (!connectedUsers.get(recipientId)?.size) {
          call.status = 'missed'
          call.endedAt = new Date()
          await call.save()
          await notifyMissedCall(call)
          acknowledge({ callId: call.id, status: 'missed' })
          socket.emit('call:finished', { callId: call.id, reason: 'offline' })
          return
        }
        reserveCall(call)
        const timer = setTimeout(async () => {
          try {
            call = await CallSession.findOneAndUpdate(
              { _id: call.id, status: 'ringing' },
              { $set: { status: 'missed', endedAt: new Date() } },
              { new: true },
            )
            if (!call) return
            releaseCall(call)
            io.to(`user:${call.caller}`).emit('call:finished', {
              callId: call.id,
              reason: 'missed',
            })
            io.to(`user:${call.recipient}`).emit('call:finished', {
              callId: call.id,
              reason: 'missed',
            })
            await notifyMissedCall(call)
          } catch (error) {
            console.error('Unable to close unanswered call', error)
          }
        }, 45000)
        timer.unref()
        ringingTimers.set(call.id, timer)
        io.to(`user:${recipientId}`).emit('call:incoming', {
          callId: call.id,
          caller: { id: caller.id, name: caller.name, avatar: caller.avatar },
          kind,
          startedAt: call.startedAt,
        })
        acknowledge({ callId: call.id, status: 'ringing' })
      } catch (error) {
        console.error('Unable to start call', error)
        acknowledge({ error: 'The call could not be started' })
      }
    })

    socket.on('call:accept', async ({ callId } = {}, acknowledge) => {
      if (typeof acknowledge !== 'function' || !/^[a-f\d]{24}$/i.test(callId ?? '')) return
      try {
        const call = await CallSession.findOneAndUpdate(
          { _id: callId, recipient: userId, status: 'ringing' },
          { $set: { status: 'active', answeredAt: new Date() } },
          { new: true },
        )
        if (!call) {
          acknowledge({ error: 'This call is no longer available' })
          return
        }
        releaseCall(call)
        io.to(`user:${call.caller}`).emit('call:accepted', {
          callId: call.id,
          peerId: String(call.recipient),
          kind: call.kind,
          initiator: true,
          answeredAt: call.answeredAt,
        })
        io.to(`user:${call.recipient}`).emit('call:accepted', {
          callId: call.id,
          peerId: String(call.caller),
          kind: call.kind,
          initiator: false,
          answeredAt: call.answeredAt,
        })
        reserveCall(call)
        acknowledge({ accepted: true })
      } catch (error) {
        console.error('Unable to accept call', error)
        acknowledge({ error: 'The call could not be accepted' })
      }
    })

    socket.on('call:reject', async ({ callId } = {}, acknowledge) => {
      if (typeof acknowledge !== 'function' || !/^[a-f\d]{24}$/i.test(callId ?? '')) return
      try {
        const call = await CallSession.findOneAndUpdate(
          { _id: callId, recipient: userId, status: 'ringing' },
          { $set: { status: 'rejected', endedAt: new Date() } },
          { new: true },
        )
        if (!call) {
          acknowledge({ error: 'This call is no longer available' })
          return
        }
        releaseCall(call)
        io.to(`user:${call.caller}`).emit('call:finished', {
          callId: call.id,
          reason: 'rejected',
        })
        socket.emit('call:finished', { callId: call.id, reason: 'rejected' })
        acknowledge({ rejected: true })
      } catch (error) {
        console.error('Unable to reject call', error)
        acknowledge({ error: 'The call could not be rejected' })
      }
    })

    socket.on('call:end', async ({ callId } = {}) => {
      if (!/^[a-f\d]{24}$/i.test(callId ?? '')) return
      try {
        const call = await CallSession.findOneAndUpdate(
          {
            _id: callId,
            $or: [{ caller: userId }, { recipient: userId }],
            status: { $in: ['ringing', 'active'] },
          },
          { $set: { status: 'ended', endedAt: new Date() } },
          { new: true },
        )
        if (!call) return
        releaseCall(call)
        for (const participant of [String(call.caller), String(call.recipient)]) {
          io.to(`user:${participant}`).emit('call:finished', {
            callId: call.id,
            reason: 'ended',
            endedAt: call.endedAt,
            answeredAt: call.answeredAt,
          })
        }
      } catch (error) {
        console.error('Unable to end call', error)
      }
    })

    socket.on('webrtc:signal', async (signal = {}) => {
      const { callId, peerId, type } = signal
      if (
        typeof callId !== 'string' ||
        !/^[a-f\d]{24}$/i.test(callId) ||
        typeof peerId !== 'string' ||
        !/^[a-f\d]{24}$/i.test(peerId) ||
        !['offer', 'answer', 'ice'].includes(type)
      ) return
      try {
        const call = await CallSession.exists({
          _id: callId,
          status: 'active',
          $or: [
            { caller: userId, recipient: peerId },
            { caller: peerId, recipient: userId },
          ],
        })
        if (!call) return
        if (type === 'ice') {
          if (typeof signal.candidate?.candidate !== 'string' || signal.candidate.candidate.length > 5000) return
        } else if (
          signal.description?.type !== type ||
          typeof signal.description.sdp !== 'string' ||
          signal.description.sdp.length > 500000
        ) return
        io.to(`user:${peerId}`).emit('webrtc:signal', {
          callId,
          fromId: userId,
          type,
          ...(type === 'ice'
            ? { candidate: signal.candidate }
            : { description: signal.description }),
        })
      } catch (error) {
        console.error('Unable to relay call signaling', error)
      }
    })

    socket.on('conversation:join', async ({ conversationId } = {}, acknowledge) => {
      if (typeof acknowledge !== 'function' || !/^[a-f\d]{24}$/i.test(conversationId ?? '')) return
      try {
        const isMember = await Conversation.exists({
          _id: conversationId,
          'members.user': userId,
        })
        if (!isMember) {
          acknowledge({ error: 'You are not a member of this group' })
          return
        }
        await socket.join(`conversation:${conversationId}`)
        acknowledge({ joined: true })
      } catch (error) {
        console.error('Unable to join group conversation', error)
        acknowledge({ error: 'The group conversation could not be joined' })
      }
    })

    socket.on('conversation:leave', ({ conversationId } = {}) => {
      if (/^[a-f\d]{24}$/i.test(conversationId ?? '')) {
        socket.leave(`conversation:${conversationId}`)
      }
    })

    socket.on('typing', async ({ recipientId, conversationId, active } = {}) => {
      const isGroupConversation =
        typeof conversationId === 'string' && /^[a-f\d]{24}$/i.test(conversationId)
      const isDirectConversation =
        typeof recipientId === 'string' &&
        /^[a-f\d]{24}$/i.test(recipientId) &&
        recipientId !== userId
      if (typeof active !== 'boolean' || (!isGroupConversation && !isDirectConversation)) return
      const now = Date.now()
      if (active && now - (socket.data.lastTypingAt ?? 0) < 500) return
      socket.data.lastTypingAt = now
      try {
        if (isGroupConversation) {
          const isMember = await Conversation.exists({
            _id: conversationId,
            'members.user': userId,
          })
          if (isMember) {
            socket.to(`conversation:${conversationId}`).emit('typing', {
              userId,
              conversationId,
              active,
            })
          }
        } else {
          const friendship = await Friendship.exists({
            status: 'accepted',
            $or: [
              { requester: userId, recipient: recipientId },
              { requester: recipientId, recipient: userId },
            ],
          })
          if (friendship) {
            io.to(`user:${recipientId}`).emit('typing', { userId, active })
          }
        }
      } catch (error) {
        console.error('Unable to deliver typing status', error)
      }
    })

    socket.on('disconnect', async () => {
      const activeSockets = connectedUsers.get(userId)
      activeSockets?.delete(socket.id)
      if (activeSockets?.size) return
      connectedUsers.delete(userId)
      const lastSeenAt = new Date()
      try {
        await User.updateOne({ _id: userId }, { $set: { lastSeenAt } })
        const friendIds = await getFriendIds(userId)
        friendIds.forEach((friendId) => {
          io.to(`user:${friendId}`).emit('presence:update', { userId, online: false })
        })
      } catch (error) {
        console.error('Unable to update last-seen time or broadcast offline presence', error)
      }
    })
  })

  io.markMessageDelivered = async (message) => {
    if (!connectedUsers.get(String(message.recipient))?.size) return message
    message.deliveredAt ??= new Date()
    await message.save()
    io.to(`user:${message.sender}`).emit('message:status', {
      messageId: message.id,
      deliveredAt: message.deliveredAt,
      readAt: message.readAt,
    })
    return message
  }

  io.deliverMessage = async (message) => {
    await io.markMessageDelivered(message)
    await message.populate('sender', 'name avatar')
    await createNotification({
      io,
      recipient: message.recipient,
      actor: message.sender,
      type: 'message',
      message: 'sent you a message',
      resourceId: message.id,
    })
    io.to(`user:${message.recipient}`).emit('message:new', message)
    io.to(`user:${message.sender}`).emit('message:new', message)
    return message
  }

  io.deliverGroupMessage = async (message) => {
    const conversation = await Conversation.findById(message.conversation).select('members')
    if (!conversation) throw new Error('Group conversation no longer exists')
    const memberIds = conversation.members.map((member) => String(member.user))
    for (const memberId of memberIds) {
      if (memberId !== String(message.sender) && connectedUsers.get(memberId)?.size) {
        message.deliveredTo.addToSet(memberId)
      }
    }
    if (message.isModified('deliveredTo')) await message.save()
    await message.populate('sender', 'name avatar')
    await Promise.all(memberIds
      .filter((memberId) => memberId !== String(message.sender))
      .map((recipient) => createNotification({
        io,
        recipient,
        actor: message.sender,
        type: 'message',
        message: 'sent a message in your group',
        resourceId: message.id,
        conversationId: conversation.id,
      })))

    const payload = message.toJSON()
    for (const memberId of memberIds) {
      io.to(`user:${memberId}`).emit('message:new', {
        ...payload,
        recipient: memberId === String(message.sender) ? null : memberId,
      })
    }
    return message
  }

  return io
}
