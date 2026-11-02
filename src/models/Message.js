import mongoose from 'mongoose'

const messageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
    text: { type: String, default: '', trim: true, maxlength: 5000 },
    type: { type: String, enum: ['text', 'image', 'video', 'audio', 'file'], default: 'text' },
    mediaUrl: { type: String, default: '' },
    mediaType: { type: String, default: '' },
    fileName: { type: String, default: '', maxlength: 120 },
    fileSize: { type: Number, default: 0 },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true, toJSON: { virtuals: true } },
)

messageSchema.index({ sender: 1, recipient: 1, createdAt: 1 })
messageSchema.index({ recipient: 1, readAt: 1, createdAt: -1 })
messageSchema.index({ conversation: 1, createdAt: -1 })

export default mongoose.model('Message', messageSchema)
