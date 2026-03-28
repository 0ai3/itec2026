import { getApps, initializeApp } from 'firebase/app'
import { getDatabase, type Database } from 'firebase/database'

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
const explicitDatabaseUrl =
  process.env.FIREBASE_DATABASE_URL ?? process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
// Firbase Realtime DB default instance name is usually <PROJECT_ID>-default-rtdb
const derivedDatabaseUrl = projectId ? `https://${projectId}-default-rtdb.europe-west1.firebasedatabase.app` : undefined

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  databaseURL: explicitDatabaseUrl ?? derivedDatabaseUrl,
}

const missingKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key)

let cachedDb: Database | null = null

export const getServerRealtimeDb = () => {
  if (cachedDb) {
    return cachedDb
  }

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing Firebase config values: ${missingKeys.join(', ')}. Set FIREBASE_DATABASE_URL (or NEXT_PUBLIC_FIREBASE_DATABASE_URL) if your Realtime Database URL is custom.`
    )
  }

  const app = getApps()[0] ?? initializeApp(firebaseConfig)
  cachedDb = getDatabase(app)
  return cachedDb
}
