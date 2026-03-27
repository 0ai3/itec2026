'use client'

import Link from 'next/link'
import { type FormEvent, useEffect, useState } from 'react'
import { onAuthStateChanged, updateProfile, type User } from 'firebase/auth'
import FirebaseLoginGate from '@/components/Navbar'
import { auth } from '@/lib/firebase'

export default function ProfilePage() {
	const [user, setUser] = useState<User | null>(auth?.currentUser ?? null)
	const [displayName, setDisplayName] = useState(auth?.currentUser?.displayName ?? '')
	const [photoURL, setPhotoURL] = useState(auth?.currentUser?.photoURL ?? '')
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [message, setMessage] = useState<string | null>(null)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	useEffect(() => {
		if (!auth) {
			return
		}

		const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
			setUser(nextUser)
			setDisplayName(nextUser?.displayName ?? '')
			setPhotoURL(nextUser?.photoURL ?? '')
		})

		return () => {
			unsubscribe()
		}
	}, [])

	const handleUpdateProfile = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!user) {
			setErrorMessage('No signed-in user found.')
			return
		}

		setErrorMessage(null)
		setMessage(null)
		setIsSubmitting(true)
		try {
			await updateProfile(user, {
				displayName: displayName.trim() || null,
				photoURL: photoURL.trim() || null,
			})
			setMessage('Profile updated successfully.')
		} catch (error) {
			if (error instanceof Error) {
				setErrorMessage(error.message)
			} else {
				setErrorMessage('Unable to update profile. Please try again.')
			}
		}
		setIsSubmitting(false)
	}

	const previewPhotoURL = photoURL.trim()

	return (
			<main className="flex-1 p-6 max-w-2xl mx-auto w-full">
		<FirebaseLoginGate/>

				<div className="flex items-center justify-between mb-6">
					<h1 className="text-2xl font-semibold">Profile</h1>
					<Link href="/workspace" className="text-sm underline">
						Back to editor
					</Link>
				</div>

				<div className="border border-black/10 rounded-xl p-5 bg-white text-black">
					<p className="text-sm text-gray-700 mb-1">Email</p>
					<p className="text-sm mb-4 break-all">{user?.email ?? 'No email available'}</p>
					<p className="text-sm text-gray-700 mb-1">User ID</p>
					<p className="text-sm mb-6 break-all">{user?.uid ?? 'Unknown'}</p>

					<form onSubmit={handleUpdateProfile}>
						<label className="block mb-2 text-sm" htmlFor="display-name">
							Display name
						</label>
						<input
							id="display-name"
							type="text"
							value={displayName}
							onChange={(event) => setDisplayName(event.target.value)}
							className="w-full border border-black/20 rounded-md px-3 py-2 mb-4"
						/>

						<label className="block mb-2 text-sm" htmlFor="photo-url">
							Photo URL
						</label>
						<input
							id="photo-url"
							type="url"
							placeholder="https://example.com/avatar.png"
							value={photoURL}
							onChange={(event) => setPhotoURL(event.target.value)}
							className="w-full border border-black/20 rounded-md px-3 py-2 mb-4"
						/>

						{previewPhotoURL ? (
							<div className="mb-4">
								<p className="text-sm text-gray-700 mb-2">Photo preview</p>
								<div
									className="h-20 w-20 rounded-full border border-black/20 bg-gray-100"
									style={{
										backgroundImage: `url(${previewPhotoURL})`,
										backgroundSize: 'cover',
										backgroundPosition: 'center',
									}}
								/>
							</div>
						) : null}

						{errorMessage ? <p className="text-sm text-red-500 mb-3">{errorMessage}</p> : null}
						{message ? <p className="text-sm text-green-600 mb-3">{message}</p> : null}

						<button
							type="submit"
							disabled={isSubmitting}
							className="bg-black text-white rounded-md px-4 py-2 disabled:opacity-60"
						>
							{isSubmitting ? 'Saving...' : 'Save profile'}
						</button>
					</form>
				</div>
			</main>

	)
}