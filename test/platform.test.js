import assert from 'node:assert/strict'
import test from 'node:test'
import Conversation from '../src/models/Conversation.js'
import CallSession from '../src/models/CallSession.js'
import Follow from '../src/models/Follow.js'
import Message from '../src/models/Message.js'
import Notification from '../src/models/Notification.js'
import conversationsRouter from '../src/routes/conversations.js'
import { buildIceServers } from '../src/routes/calls.js'
import {
  getMessageMediaType,
  messageUploadsDirectory,
  uploadsDirectory,
} from '../src/middleware/mediaUpload.js'

test('follows enforce unique directed relationships and query indexes', () => {
  const indexes = Follow.schema.indexes()
  assert.ok(indexes.some(([keys, options]) => (
    keys.follower === 1 && keys.following === 1 && options.unique
  )))
  assert.ok(indexes.some(([keys]) => keys.following === 1 && keys.createdAt === -1))
})

test('messages support text, attachments, delivery and read receipts', () => {
  assert.deepEqual(Message.schema.path('type').enumValues, [
    'text',
    'image',
    'video',
    'audio',
    'file',
  ])
  assert.ok(Message.schema.path('deliveredAt'))
  assert.ok(Message.schema.path('readAt'))
  assert.ok(Message.schema.path('conversation'))
  assert.ok(Message.schema.indexes().some(([keys]) => (
    keys.recipient === 1 && keys.readAt === 1
  )))
})

test('message media accepts supported audio and safe document MIME types only', () => {
  assert.equal(getMessageMediaType('audio/webm;codecs=opus').type, 'audio')
  assert.equal(getMessageMediaType('application/pdf').type, 'file')
  assert.equal(getMessageMediaType('text/plain').type, 'file')
  assert.equal(getMessageMediaType('text/html'), null)
  assert.notEqual(messageUploadsDirectory, uploadsDirectory)
})

test('notifications have read-state and recipient indexes', () => {
  assert.ok(Notification.schema.path('readAt'))
  assert.ok(Notification.schema.indexes().some(([keys]) => (
    keys.recipient === 1 && keys.readAt === 1
  )))
})

test('group conversations have indexed memberships and validate member count', () => {
  assert.equal(typeof conversationsRouter, 'function')
  const memberCountValidator = Conversation.schema.path('members').validators
    .find((validator) => validator.type === 'user defined')
  assert.ok(memberCountValidator)
  assert.equal(memberCountValidator.validator([{ user: 'a' }, { user: 'b' }]), false)
  assert.equal(memberCountValidator.validator([{ user: 'a' }, { user: 'b' }, { user: 'c' }]), true)
  assert.ok(Conversation.schema.indexes().some(([keys]) => (
    keys['members.user'] === 1 && keys.updatedAt === -1
  )))
})

test('calls persist one-to-one call states and index call history', () => {
  assert.deepEqual(CallSession.schema.path('kind').enumValues, ['audio', 'video'])
  assert.deepEqual(CallSession.schema.path('status').enumValues, [
    'ringing',
    'active',
    'ended',
    'rejected',
    'missed',
  ])
  assert.ok(CallSession.schema.indexes().some(([keys]) => (
    keys.caller === 1 && keys.createdAt === -1
  )))
})

test('ICE configuration issues temporary TURN credentials and rejects invalid settings', () => {
  const iceServers = buildIceServers({
    stunUrls: ['stun:stun.example.test:3478'],
    turnUrls: ['turn:turn.example.test:3478?transport=udp'],
    sharedSecret: 'test-secret',
    ttlSeconds: '600',
  }, 'user-id', 1_700_000_000_000)

  assert.deepEqual(iceServers[0], { urls: ['stun:stun.example.test:3478'] })
  assert.deepEqual(iceServers[1].urls, ['turn:turn.example.test:3478?transport=udp'])
  assert.equal(iceServers[1].username, '1700000600:user-id')
  assert.ok(iceServers[1].credential)
  assert.throws(() => buildIceServers({
    stunUrls: [],
    turnUrls: ['turn:turn.example.test:3478'],
    sharedSecret: '',
    ttlSeconds: '3600',
  }, 'user-id'), /TURN_URLS requires TURN_SHARED_SECRET/)
  assert.throws(() => buildIceServers({
    stunUrls: ['not-an-ice-url'],
    turnUrls: [],
    sharedSecret: '',
  }, 'user-id'), /valid ICE server URLs/)
})
