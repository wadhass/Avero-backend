import mongoose from 'mongoose'

const friendshipSchema = new mongoose.Schema(
  {
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pairKey: { type: String, required: true, unique: true, select: false },
    status: { type: String, enum: ['pending', 'accepted'], default: 'pending' },
  },
  { timestamps: true, toJSON: { virtuals: true } },
)

friendshipSchema.pre('validate', function () {
  if (this.requester && this.recipient) {
    this.pairKey = [this.requester.toString(), this.recipient.toString()].sort().join(':')
  }
})

export default mongoose.model('Friendship', friendshipSchema)
