import resolveUserFromToken from './resolveUserFromToken.js'

export default async function authenticate(req, res, next) {
  const authorization = req.get('authorization')
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''

  if (!token) {
    return res.status(401).json({ message: 'Sign in to continue' })
  }

  try {
    req.user = await resolveUserFromToken(token)
    return next()
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message })
    return next(error)
  }
}
