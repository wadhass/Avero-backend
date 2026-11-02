import mongoose from 'mongoose'

const callSessionSchema = new mongoose.Schema(
  {
    caller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['audio', 'video'], required: true },
    status: {
      type: String,
      enum: ['ringing', 'active', 'ended', 'rejected', 'missed'],
      default: 'ringing',
    },
    startedAt: { type: Date, default: Date.now },
    answeredAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

callSessionSchema.index({ caller: 1, createdAt: -1 })
callSessionSchema.index({ recipient: 1, createdAt: -1 })

export default mongoose.model('CallSession', callSessionSchema)
