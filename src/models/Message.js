import mongoose from 'mongoose'

const messageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 5000 },
  },
  { timestamps: true, toJSON: { virtuals: true } },
)

messageSchema.index({ sender: 1, recipient: 1, createdAt: 1 })

export default mongoose.model('Message', messageSchema)
