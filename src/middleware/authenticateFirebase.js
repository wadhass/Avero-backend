import jwt from 'jsonwebtoken'
import resolveUserFromToken from './resolveUserFromToken.js'

export default async function authenticateFirebase(req, res, next) {
  const authorization = req.get('authorization')
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''
  const claims = token ? jwt.decode(token) : null

  if (
    typeof claims?.iss !== 'string' ||
    !claims.iss.startsWith('https://securetoken.google.com/')
  ) {
    return res.status(401).json({ message: 'A Firebase sign-in is required' })
  }

  try {
    req.user = await resolveUserFromToken(token)
    return next()
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message })
    return next(error)
  }
}
