'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'
import {
	collection,
	collectionGroup,
	doc,
	getDoc,
	getDocs,
	serverTimestamp,
	setDoc,
} from 'firebase/firestore'
import { onAuthStateChanged, type User } from 'firebase/auth'
import Navbar from '@/components/Navbar'
import Editor from '@/components/editor'
import { auth, db } from '@/lib/firebase'

type InviteRecord = {
	email: string
	status?: string
}

const normalizeEmail = (email: string) => email.trim().toLowerCase()

const getOwnerLabel = (ownerName?: string | null, ownerEmail?: string | null) => {
	if (ownerName && ownerName.trim()) {
		return ownerName
	}
	if (ownerEmail && ownerEmail.includes('@')) {
		return ownerEmail.split('@')[0]
	}
	return 'Unknown user'
}

const getOwnerUidFromRepoPath = (path: string) => {
	const segments = path.split('/')
	return segments.length >= 2 ? segments[1] : null
}

export default function RepoEditorPage() {
	const params = useParams<{ id: string }>()
	const router = useRouter()
	const repoId = params.id
	const [user, setUser] = useState<User | null>(auth?.currentUser ?? null)
	const [ownerUid, setOwnerUid] = useState<string | null>(null)
	const [ownerName, setOwnerName] = useState<string | null>(null)
	const [ownerEmail, setOwnerEmail] = useState<string | null>(null)
	const [isOwner, setIsOwner] = useState(false)
	const [repoName, setRepoName] = useState<string | null>(null)
	const [inviteEmail, setInviteEmail] = useState('')
	const [invites, setInvites] = useState<InviteRecord[]>([])
	const [inviteMessage, setInviteMessage] = useState<string | null>(null)
	const [inviteError, setInviteError] = useState<string | null>(null)
	const [isInviting, setIsInviting] = useState(false)
	const [isCheckingAccess, setIsCheckingAccess] = useState(Boolean(auth))
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [collaborationRoomId, setCollaborationRoomId] = useState<string>(repoId)

	useEffect(() => {
		if (!auth) {
			return
		}

		const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
			setUser(nextUser)
			if (!nextUser) {
				router.replace('/login')
			}
		})

		return () => {
			unsubscribe()
		}
	}, [router])

	useEffect(() => {
		const checkAccess = async () => {
			if (!db || !user) {
				setOwnerUid(null)
				setOwnerName(null)
				setOwnerEmail(null)
				setIsOwner(false)
				setRepoName(null)
				setCollaborationRoomId(repoId)
				setIsCheckingAccess(false)
				return
			}

			setIsCheckingAccess(true)
			setErrorMessage(null)
			setInviteError(null)
			setInviteMessage(null)

			try {
				const myRepoSnapshot = await getDoc(doc(db, 'users', user.uid, 'repos', repoId))
				if (myRepoSnapshot.exists()) {
					const myRepoData = myRepoSnapshot.data() as {
						name?: string
						role?: 'owner' | 'collaborator'
						ownerName?: string
						ownerUid?: string
						ownerEmail?: string
					}

					const effectiveOwnerUid =
						myRepoData.role === 'collaborator' && myRepoData.ownerUid
							? myRepoData.ownerUid
							: user.uid
					let effectiveOwnerName = myRepoData.ownerName
					let effectiveOwnerEmail = myRepoData.ownerEmail ?? user.email ?? null

					if (
						myRepoData.role === 'collaborator' &&
						effectiveOwnerUid &&
						!effectiveOwnerName &&
						!effectiveOwnerEmail
					) {
						const ownerRepoDoc = await getDoc(
							doc(db, 'users', effectiveOwnerUid, 'repos', repoId)
						)
						if (ownerRepoDoc.exists()) {
							const ownerRepoData = ownerRepoDoc.data() as {
								ownerName?: string
								ownerEmail?: string
							}
							effectiveOwnerName = ownerRepoData.ownerName
							effectiveOwnerEmail = ownerRepoData.ownerEmail ?? effectiveOwnerEmail
						}

						const currentEmail = normalizeEmail(user.email ?? '')
						if (!effectiveOwnerEmail && currentEmail) {
							const inviteDoc = await getDoc(
								doc(
									db,
									'users',
									effectiveOwnerUid,
									'repos',
									repoId,
									'invites',
									encodeURIComponent(currentEmail)
								)
							)
							if (inviteDoc.exists()) {
								const inviteData = inviteDoc.data() as { invitedByEmail?: string }
								effectiveOwnerEmail = inviteData.invitedByEmail ?? effectiveOwnerEmail
							}
						}

						if (effectiveOwnerName || effectiveOwnerEmail) {
							await setDoc(
								doc(db, 'users', user.uid, 'repos', repoId),
								{
									ownerName: effectiveOwnerName ?? null,
									ownerEmail: effectiveOwnerEmail ?? null,
								},
								{ merge: true }
							)
						}
					}
					const ownerView = effectiveOwnerUid === user.uid

					setRepoName(myRepoData.name ?? repoId)
					setOwnerUid(effectiveOwnerUid)
					setOwnerName(effectiveOwnerName ?? null)
					setOwnerEmail(effectiveOwnerEmail)
					setIsOwner(ownerView)
					setCollaborationRoomId(`${effectiveOwnerUid}:${repoId}`)

					if (ownerView) {
						const invitesSnapshot = await getDocs(
							collection(db, 'users', effectiveOwnerUid, 'repos', repoId, 'invites')
						)
						setInvites(
							invitesSnapshot.docs.map((inviteDoc) => {
								const inviteData = inviteDoc.data() as InviteRecord
								return {
									email: inviteData.email,
									status: inviteData.status,
								}
							})
						)
					} else {
						setInvites([])
					}

					setIsCheckingAccess(false)
					return
				}

				const repoResults = await getDocs(collectionGroup(db, 'repos'))
				const matchingRepoDocs = repoResults.docs.filter((repoDoc) => repoDoc.id === repoId)

				if (matchingRepoDocs.length === 0) {
					setErrorMessage('Repo not found.')
					return
				}

				const currentUserEmail = normalizeEmail(user.email ?? '')
				let matchedRepo: {
					name: string
					ownerId: string
					ownerView: boolean
					ownerName?: string
					ownerEmail?: string
				} | null = null

				for (const repoDoc of matchingRepoDocs) {
					const candidateOwnerUid = getOwnerUidFromRepoPath(repoDoc.ref.path)
					if (!candidateOwnerUid) {
						continue
					}

					const data = repoDoc.data() as { name?: string; ownerName?: string; ownerEmail?: string }
					if (candidateOwnerUid === user.uid) {
						matchedRepo = {
							name: data.name ?? repoId,
							ownerId: candidateOwnerUid,
							ownerView: true,
							ownerName: data.ownerName,
							ownerEmail: data.ownerEmail,
						}
						break
					}

					if (!currentUserEmail) {
						continue
					}

					const inviteDocRef = doc(
						db,
						'users',
						candidateOwnerUid,
						'repos',
						repoId,
						'invites',
						encodeURIComponent(currentUserEmail)
					)
					const inviteDoc = await getDoc(inviteDocRef)
					if (!inviteDoc.exists()) {
						continue
					}

					matchedRepo = {
						name: data.name ?? repoId,
						ownerId: candidateOwnerUid,
						ownerView: false,
						ownerName: data.ownerName,
						ownerEmail: data.ownerEmail,
					}
					break
				}

				if (!matchedRepo) {
					setErrorMessage('You do not have access to this repo.')
					setOwnerUid(null)
					setOwnerName(null)
					setOwnerEmail(null)
					setIsOwner(false)
					setRepoName(null)
					setCollaborationRoomId(repoId)
					setInvites([])
					return
				}

				setRepoName(matchedRepo.name)
				setOwnerUid(matchedRepo.ownerId)
				setOwnerName(matchedRepo.ownerName ?? null)
				setOwnerEmail(matchedRepo.ownerEmail ?? null)
				setIsOwner(matchedRepo.ownerView)
				setCollaborationRoomId(`${matchedRepo.ownerId}:${repoId}`)

				if (matchedRepo.ownerView) {
					const invitesSnapshot = await getDocs(
						collection(db, 'users', matchedRepo.ownerId, 'repos', repoId, 'invites')
					)
					setInvites(
						invitesSnapshot.docs.map((inviteDoc) => {
							const inviteData = inviteDoc.data() as InviteRecord
							return {
								email: inviteData.email,
								status: inviteData.status,
							}
						})
					)
				} else {
					setInvites([])
				}
			} catch (error) {
				if (error instanceof Error) {
					setErrorMessage(error.message)
				} else {
					setErrorMessage('Unable to load repo.')
				}
				setOwnerUid(null)
				setOwnerName(null)
				setOwnerEmail(null)
				setIsOwner(false)
				setRepoName(null)
				setCollaborationRoomId(repoId)
				setInvites([])
			}

			setIsCheckingAccess(false)
		}

		void checkAccess()
	}, [repoId, user])

	const handleInviteCollaborator = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		if (!db || !user || !ownerUid || !isOwner) {
			setInviteError('Only the repo owner can invite collaborators.')
			return
		}

		const normalizedInviteEmail = normalizeEmail(inviteEmail)
		if (!normalizedInviteEmail || !normalizedInviteEmail.includes('@')) {
			setInviteError('Enter a valid email address.')
			return
		}

		setInviteError(null)
		setInviteMessage(null)
		setIsInviting(true)

		try {
			const inviteRef = doc(
				db,
				'users',
				ownerUid,
				'repos',
				repoId,
				'invites',
				encodeURIComponent(normalizedInviteEmail)
			)

			await setDoc(
				inviteRef,
				{
					email: normalizedInviteEmail,
					status: 'invited',
					invitedByUid: user.uid,
					invitedByEmail: user.email ?? null,
					invitedAt: serverTimestamp(),
				},
				{ merge: true }
			)

			setInvites((prevInvites) => {
				const withoutExisting = prevInvites.filter(
					(existingInvite) => normalizeEmail(existingInvite.email) !== normalizedInviteEmail
				)
				return [...withoutExisting, { email: normalizedInviteEmail, status: 'invited' }]
			})
			setInviteEmail('')
			setInviteMessage(`Invitation saved for ${normalizedInviteEmail}.`)
		} catch (error) {
			if (error instanceof Error) {
				setInviteError(error.message)
			} else {
				setInviteError('Unable to invite collaborator.')
			}
		}

		setIsInviting(false)
	}

	if (isCheckingAccess) {
		return (
			<main className="flex-1 flex flex-col">
				<Navbar />
				<section className="p-6">
					<p className="text-sm text-gray-500">Loading repo...</p>
				</section>
			</main>
		)
	}

	if (errorMessage) {
		return (
			<main className="flex-1 flex flex-col">
				<Navbar />
				<section className="p-6 max-w-3xl w-full mx-auto">
					<p className="text-sm text-red-500 mb-4">{errorMessage}</p>
					<Link href="/workspace" className="text-sm underline">
						Back to repos
					</Link>
				</section>
			</main>
		)
	}

	return (
		<main className="flex-1 flex flex-col">
			<Navbar />
			<section className="px-6 pt-4 pb-4">
				<h1 className="text-xl font-semibold">{repoName ?? 'Repo editor'}</h1>
				<p className="text-sm text-gray-600">Repo ID: {repoId}</p>
				<p className="text-sm text-gray-600">
					Access: {isOwner ? 'Owner' : 'Collaborator'}
				</p>
				{!isOwner ? (
					<p className="text-sm text-gray-600">
						Collaborator, owned by: {getOwnerLabel(ownerName, ownerEmail)}
					</p>
				) : null}

				{isOwner ? (
					<div className="mt-4 border border-black/10 rounded-xl p-4 max-w-2xl">
						<h2 className="font-semibold mb-3">Invite collaborators</h2>
						<form onSubmit={handleInviteCollaborator} className="flex gap-2 flex-wrap">
							<input
								type="email"
								value={inviteEmail}
								onChange={(event) => setInviteEmail(event.target.value)}
								placeholder="collaborator@email.com"
								className="flex-1 min-w-64 border border-black/20 rounded-md px-3 py-2"
							/>
							<button
								type="submit"
								disabled={isInviting}
								className="bg-black text-white rounded-md px-4 py-2 disabled:opacity-60"
							>
								{isInviting ? 'Inviting...' : 'Invite'}
							</button>
						</form>

						{inviteError ? <p className="text-sm text-red-500 mt-3">{inviteError}</p> : null}
						{inviteMessage ? <p className="text-sm text-green-600 mt-3">{inviteMessage}</p> : null}

						<div className="mt-4">
							<p className="text-sm font-medium mb-2">Invited collaborators</p>
							{invites.length === 0 ? (
								<p className="text-sm text-gray-500">No collaborators invited yet.</p>
							) : (
								<ul className="space-y-1">
									{invites.map((invite) => (
										<li key={invite.email} className="text-sm text-gray-700">
											{invite.email} {invite.status ? `(${invite.status})` : ''}
										</li>
									))}
								</ul>
							)}
						</div>
					</div>
				) : null}
			</section>
			<Editor roomId={collaborationRoomId} />
		</main>
	)
}
