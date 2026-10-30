import nodemailer from 'nodemailer'

let cachedEmailConfig

export function getEmailConfig() {
  if (cachedEmailConfig) return cachedEmailConfig

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env
  const port = Number(SMTP_PORT)
  if (
    !SMTP_HOST ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !SMTP_USER ||
    !SMTP_PASSWORD ||
    !SMTP_FROM
  ) {
    const error = new Error('Password reset email is not configured. Set the SMTP_* values in backend/.env.')
    error.status = 503
    throw error
  }

  cachedEmailConfig = {
    from: SMTP_FROM,
    transport: nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    }),
  }

  return cachedEmailConfig
}

export async function verifyEmailConnection() {
  const { transport } = getEmailConfig()
  return transport.verify()
}
