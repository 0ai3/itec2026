'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { useRouter } from 'next/navigation'
import { auth, firebaseConfigError } from '@/lib/firebase'


export default function FirebaseLoginGate() {
	const router = useRouter()
	const [user, setUser] = useState<User | null>(null)
	const [isLoadingUser, setIsLoadingUser] = useState(Boolean(auth))

	useEffect(() => {
		if (!auth) {
			return
		}

		const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
			if (!nextUser) {
				router.replace('/login')
			}
			setUser(nextUser)
			setIsLoadingUser(false)
		})

		return () => {
			unsubscribe()
		}
	}, [router])

	const handleLogout = async () => {
		if (!auth) {
			return
		}
		await signOut(auth)
		router.replace('/login')
	}

	if (firebaseConfigError) {
		return (
			<main className="flex-1 p-8 max-w-2xl mx-auto w-full">
				<h1 className="text-2xl font-semibold mb-4">Firebase Login Setup Required</h1>
				<p className="text-sm text-red-500">{firebaseConfigError}</p>
				<p className="text-sm mt-3 text-gray-500">
					Add the values to <code>.env.local</code> and restart the dev server.
				</p>
			</main>
		)
	}

	if (isLoadingUser) {
		return (
			<main className="flex-1 grid place-items-center p-8">
				<p className="text-sm text-gray-500">Checking authentication...</p>
			</main>
		)
	}

	if (!user) {
		return (
			<main className="flex-1 grid place-items-center p-8">
				<p className="text-sm text-gray-500">Redirecting to login...</p>
			</main>
		)
	}

	return (
		<>
			<header className="px-6 py-3 border-b border-black/10 flex items-center justify-between gap-3">
				<p className="text-sm text-gray-600 truncate">Signed in as {user.email ?? 'Firebase user'}</p>
				<div className="flex items-center gap-2">
					<button
						onClick={handleLogout}
						className="text-sm border border-black/20 rounded-md px-3 py-1.5"
					>
						Sign out
					</button>
				</div>
			</header>

		</>
	)
}