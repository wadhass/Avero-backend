import { getEmailConfig } from '../config/email.js'

export default async function sendEmail({ to, subject, html, text }) {
  const { from, transport } = getEmailConfig()
  return transport.sendMail({ from, to, subject, html, text })
}
