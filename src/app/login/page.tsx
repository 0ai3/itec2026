'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useState } from 'react'
import { GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth'
import { auth, firebaseConfigError } from '@/lib/firebase'

const googleProvider = new GoogleAuthProvider()

export default function LoginPage() {
	const router = useRouter()
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [isSubmitting, setIsSubmitting] = useState(false)

	useEffect(() => {
		if (!auth) {
			return
		}

		const unsubscribe = onAuthStateChanged(auth, (user) => {
			if (user) {
				router.replace('/workspace')
			}
		})

		return () => {
			unsubscribe()
		}
	}, [router])

	const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!auth) {
			setErrorMessage('Firebase is not configured yet.')
			return
		}

		setErrorMessage(null)
		setIsSubmitting(true)
		try {
			await signInWithEmailAndPassword(auth, email.trim(), password)
			router.replace('/workspace')
		} catch (error) {
			if (error instanceof Error) {
				setErrorMessage(error.message)
			} else {
				setErrorMessage('Unable to sign in. Please try again.')
			}
			setIsSubmitting(false)
			return
		}
		setIsSubmitting(false)
	}

	const handleGoogleLogin = async () => {
		if (!auth) {
			setErrorMessage('Firebase is not configured yet.')
			return
		}

		setErrorMessage(null)
		setIsSubmitting(true)
		try {
			await signInWithPopup(auth, googleProvider)
			router.replace('/workspace')
		} catch (error) {
			if (error instanceof Error) {
				setErrorMessage(error.message)
			} else {
				setErrorMessage('Unable to sign in with Google. Please try again.')
			}
			setIsSubmitting(false)
			return
		}
		setIsSubmitting(false)
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

	return (
		<main className="flex-1 grid place-items-center p-6">
			<form
				onSubmit={handleLogin}
				className="w-full max-w-sm border border-black/10 rounded-xl p-6 bg-white text-black shadow-sm"
			>
				<h1 className="text-xl font-semibold mb-4">Login</h1>
				<label className="block mb-2 text-sm" htmlFor="email">
					Email
				</label>
				<input
					id="email"
					type="email"
					required
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					className="w-full border border-black/20 rounded-md px-3 py-2 mb-4"
				/>

				<label className="block mb-2 text-sm" htmlFor="password">
					Password
				</label>
				<input
					id="password"
					type="password"
					required
					value={password}
					onChange={(event) => setPassword(event.target.value)}
					className="w-full border border-black/20 rounded-md px-3 py-2 mb-4"
				/>

				{errorMessage ? <p className="text-sm text-red-500 mb-3">{errorMessage}</p> : null}

				<button
					type="submit"
					disabled={isSubmitting}
					className="w-full bg-black text-white rounded-md px-3 py-2 disabled:opacity-60"
				>
					{isSubmitting ? 'Signing in...' : 'Sign in'}
				</button>

				<button
					type="button"
					onClick={handleGoogleLogin}
					disabled={isSubmitting}
					className="w-full mt-3 border border-black/20 rounded-md px-3 py-2 disabled:opacity-60"
				>
					Continue with Google
				</button>

				<p className="text-sm text-gray-600 mt-4">
					Don&apos;t have an account?{' '}
					<Link href="/register" className="underline">
						Create one
					</Link>
				</p>
			</form>
		</main>
	)
}