import mongoose from 'mongoose'

const memberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
)

const conversationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 80 },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [memberSchema], validate: (members) => members.length >= 3 },
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  },
  { timestamps: true },
)

conversationSchema.index({ 'members.user': 1, updatedAt: -1 })

export default mongoose.model('Conversation', conversationSchema)
