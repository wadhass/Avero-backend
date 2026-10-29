import mongoose from 'mongoose'

export default async function connectDatabase() {
  const { MONGODB_URI } = process.env

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is required')
  }

  await mongoose.connect(MONGODB_URI)
  console.log('Connected to MongoDB')
}
