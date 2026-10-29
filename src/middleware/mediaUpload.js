import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import multer from 'multer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HttpError } from '../utils/errors.js'

export const uploadsDirectory = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads')

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

export async function removeUploadedMedia(mediaUrl) {
  const filename = mediaUrl.startsWith('/uploads/')
    ? mediaUrl.slice('/uploads/'.length)
    : ''
  if (!/^[\da-f-]{36}\.(jpg|png|gif|webp|avif|mp4|webm|mov)$/.test(filename)) return
  await rm(path.join(uploadsDirectory, filename), { force: true })
}

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, callback) => {
      try {
        await mkdir(uploadsDirectory, { recursive: true })
        callback(null, uploadsDirectory)
      } catch (error) {
        callback(error)
      }
    },
    filename: (req, file, callback) => {
      const mediaType = mediaTypes.get(file.mimetype)
      callback(null, `${randomUUID()}${mediaType.extension}`)
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 1, fieldSize: 5000 },
  fileFilter: (req, file, callback) => {
    if (!mediaTypes.has(file.mimetype)) {
      callback(new HttpError(400, 'Choose a supported image or video file'))
      return
    }
    callback(null, true)
  },
})

export function receiveMedia(req, res, next) {
  upload.single('media')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'Media files must be 50 MB or smaller'
        : 'Only one media file and up to 5000 characters of text are allowed'
      return next(new HttpError(400, message))
    }
    return next(error)
  })
}
