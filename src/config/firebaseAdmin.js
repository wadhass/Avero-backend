import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  'qavero-application'
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
const useApplicationDefaultCredentials = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS)

function createFirebaseAdminApp() {
  if (getApps().length) return getApps()[0]

  const options = { projectId }
  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson)
    options.credential = cert({
      ...serviceAccount,
      privateKey: serviceAccount.private_key?.replace(/\\n/g, '\n'),
    })
  } else if (useApplicationDefaultCredentials) {
    options.credential = applicationDefault()
  }

  return initializeApp(options)
}

const firebaseApp = createFirebaseAdminApp()

export async function verifyFirebaseIdToken(token) {
  return getAuth(firebaseApp).verifyIdToken(
    token,
    Boolean(serviceAccountJson || useApplicationDefaultCredentials),
  )
}

export function getFirebaseProjectId() {
  return projectId
}
