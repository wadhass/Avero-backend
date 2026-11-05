import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import multer from 'multer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HttpError } from '../utils/errors.js'

export const uploadsDirectory = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads')
export const messageUploadsDirectory = path.resolve(uploadsDirectory, '..', 'private-message-uploads')

export const mediaTypes = new Map([
  ['image/jpeg', { type: 'image', extension: '.jpg' }],
  ['image/png', { type: 'image', extension: '.png' }],
  ['image/gif', { type: 'image', extension: '.gif' }],
  ['image/webp', { type: 'image', extension: '.webp' }],
  ['image/avif', { type: 'image', extension: '.avif' }],
  ['video/mp4', { type: 'video', extension: '.mp4' }],
  ['video/webm', { type: 'video', extension: '.webm' }],
  ['video/quicktime', { type: 'video', extension: '.mov' }],
])

const messageMediaTypes = new Map([
  ...mediaTypes,
  ['audio/webm', { type: 'audio', extension: '.webm' }],
  ['audio/ogg', { type: 'audio', extension: '.ogg' }],
  ['audio/mpeg', { type: 'audio', extension: '.mp3' }],
  ['audio/mp4', { type: 'audio', extension: '.m4a' }],
  ['audio/wav', { type: 'audio', extension: '.wav' }],
  ['audio/x-wav', { type: 'audio', extension: '.wav' }],
  ['audio/aac', { type: 'audio', extension: '.aac' }],
  ['application/pdf', { type: 'file', extension: '.pdf' }],
  ['text/plain', { type: 'file', extension: '.txt' }],
])

function getNormalizedMessageMediaType(mimeType) {
  return messageMediaTypes.get(mimeType.toLowerCase().split(';', 1)[0])
}

export async function removeUploadedMedia(mediaUrl) {
  const filename = mediaUrl.startsWith('/uploads/')
    ? mediaUrl.slice('/uploads/'.length)
    : ''
  if (!/^[\da-f-]{36}\.(jpg|png|gif|webp|avif|mp4|webm|mov)$/.test(filename)) return
  await rm(path.join(uploadsDirectory, filename), { force: true })
}

export async function removeUploadedMessageMedia(mediaUrl) {
  const filename = mediaUrl.startsWith('/api/messages/media/')
    ? mediaUrl.slice('/api/messages/media/'.length)
    : ''
  if (!/^[\da-f-]{36}\.(jpg|png|gif|webp|avif|mp4|webm|mov|ogg|mp3|m4a|wav|aac|pdf|txt)$/.test(filename)) return
  await rm(path.join(messageUploadsDirectory, filename), { force: true })
}

const storage = multer.diskStorage({
  destination: async (req, file, callback) => {
    try {
      await mkdir(uploadsDirectory, { recursive: true })
      callback(null, uploadsDirectory)
    } catch (error) {
      callback(error)
    }
  },
  filename: (req, file, callback) => {
    const mediaType = mediaTypes.get(file.mimetype) ?? messageMediaTypes.get(file.mimetype)
    callback(null, `${randomUUID()}${mediaType.extension}`)
  },
})

const messageStorage = multer.diskStorage({
  destination: async (req, file, callback) => {
    try {
      await mkdir(messageUploadsDirectory, { recursive: true })
      callback(null, messageUploadsDirectory)
    } catch (error) {
      callback(error)
    }
  },
  filename: (req, file, callback) => {
    callback(null, `${randomUUID()}${getNormalizedMessageMediaType(file.mimetype).extension}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 1, fieldSize: 5000 },
  fileFilter: (req, file, callback) => {
    if (!mediaTypes.has(file.mimetype)) {
      callback(new HttpError(400, 'Choose a supported image or video file'))
      return
    }
    callback(null, true)
  },
})

const avatarUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter: (req, file, callback) => {
    if (mediaTypes.get(file.mimetype)?.type !== 'image') {
      callback(new HttpError(400, 'Choose a supported image file for your profile picture'))
      return
    }
    callback(null, true)
  },
})

const messageUpload = multer({
  storage: messageStorage,
  limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 1, fieldSize: 5000 },
  fileFilter: (req, file, callback) => {
    if (!getNormalizedMessageMediaType(file.mimetype)) {
      callback(new HttpError(400, 'Choose a supported image, video, audio, PDF, or text file'))
      return
    }
    callback(null, true)
  },
})

function receiveUpload(middleware, field, req, res, next) {
  middleware.single(field)(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? field === 'avatar' ? 'Profile pictures must be 5 MB or smaller' : 'Media files must be 50 MB or smaller'
        : field === 'avatar'
          ? 'Choose one profile picture'
          : 'Only one media file and up to 5000 characters of text are allowed'
      return next(new HttpError(400, message))
    }
    return next(error)
  })
}

export function receiveMedia(req, res, next) {
  receiveUpload(upload, 'media', req, res, next)
}

export function receiveAvatar(req, res, next) {
  receiveUpload(avatarUpload, 'avatar', req, res, next)
}

export function receiveMessageAttachment(req, res, next) {
  receiveUpload(messageUpload, 'media', req, res, next)
}

export function getMessageMediaType(mimeType) {
  return getNormalizedMessageMediaType(mimeType) ?? null
}

export function getMessageMediaContentType(mediaType, filename) {
  if (mediaType !== 'audio') return null
  return new Map([
    ['.webm', 'audio/webm'],
    ['.ogg', 'audio/ogg'],
    ['.mp3', 'audio/mpeg'],
    ['.m4a', 'audio/mp4'],
    ['.wav', 'audio/wav'],
    ['.aac', 'audio/aac'],
  ]).get(path.extname(filename).toLowerCase()) ?? 'application/octet-stream'
}
