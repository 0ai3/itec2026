import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'

const firebaseConfig = {
	apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
	authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
	projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
	storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
	appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const missingConfigKeys = Object.entries(firebaseConfig)
	.filter(([, value]) => !value)
	.map(([key]) => key)

export const firebaseConfigError =
	missingConfigKeys.length > 0
		? `Missing Firebase config values: ${missingConfigKeys.join(', ')}`
		: null

let app: FirebaseApp | null = null
let auth: Auth | null = null

if (!firebaseConfigError) {
	app = getApps()[0] ?? initializeApp(firebaseConfig)
	auth = getAuth(app)
}

export { app, auth }