import mongoose from 'mongoose'

const storySchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    mediaUrl: { type: String, required: true },
    mediaType: { type: String, enum: ['image', 'video'], required: true },
    text: { type: String, default: '', trim: true, maxlength: 500 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, toJSON: { virtuals: true } },
)

storySchema.index({ expiresAt: 1 })

export default mongoose.model('Story', storySchema)
