import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    type: {
      type: String,
      enum: [
        'friend_request',
        'friend_accepted',
        'follow',
        'message',
        'call',
        'like',
        'comment',
        'mention',
        'share',
        'live',
      ],
      required: true,
    },
    message: { type: String, required: true, maxlength: 160 },
    resourceId: { type: String, default: '' },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null,
    },
    readAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } },
)

notificationSchema.index({ recipient: 1, createdAt: -1 })
notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 })

export default mongoose.model('Notification', notificationSchema)
