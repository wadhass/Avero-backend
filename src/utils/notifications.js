import Notification from '../models/Notification.js'

export async function createNotification({
  io,
  recipient,
  actor,
  type,
  message,
  resourceId = '',
  conversationId = null,
}) {
  if (String(recipient) === String(actor)) return null

  const notification = await Notification.create({
    recipient,
    actor,
    type,
    message,
    resourceId,
    conversationId,
  })
  await notification.populate('actor', 'name avatar')
  io?.to(`user:${recipient}`).emit('notification:new', notification)
  return notification
}
