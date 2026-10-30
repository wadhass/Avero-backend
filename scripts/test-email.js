import 'dotenv/config'
import sendEmail from '../src/utils/sendEmail.js'
import { verifyEmailConnection } from '../src/config/email.js'

const to = process.argv[2]

if (!to) {
  console.error('Usage: npm run test:email -- recipient@example.com')
  process.exitCode = 1
} else {
  try {
    await verifyEmailConnection()
    console.log('SMTP connection verified.')

    const result = await sendEmail({
      to,
      subject: 'Welcome to Qavero!',
      html: '<div style="font-family: Arial; padding: 20px;"><h1>Welcome to Qavero!</h1><p>Your email service is working successfully.</p><p>Thank you for joining Qavero.</p></div>',
    })

    console.log('Test email sent:', result.messageId)
  } catch (error) {
    console.error('Email test failed:', error.message)
    process.exitCode = 1
  }
}
