import mongoose from 'mongoose'

const liveStreamSchema = new mongoose.Schema(
  {
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    roomName: { type: String, required: true, unique: true },
    status: { type: String, enum: ['live', 'ended'], default: 'live' },
    startedAt: { type: Date, default: Date.now },
    lastHeartbeatAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

liveStreamSchema.index(
  { host: 1 },
  { unique: true, partialFilterExpression: { status: 'live' } },
)
liveStreamSchema.index({ status: 1, startedAt: -1 })

export default mongoose.model('LiveStream', liveStreamSchema)
