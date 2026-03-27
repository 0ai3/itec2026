'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Timestamp,
} from 'firebase/firestore'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'
import { auth, db } from '@/lib/firebase'

type RepoRecord = {
  id: string
  name: string
  createdAt?: Timestamp
  role?: 'owner' | 'collaborator'
  ownerName?: string
  ownerUid?: string
  ownerEmail?: string
}

type InvitedRepoRecord = {
  id: string
  name: string
  ownerName?: string
  ownerUid: string
  ownerEmail?: string
}

const normalizeEmail = (email: string) => email.trim().toLowerCase()

const getOwnerLabel = (ownerName?: string, ownerEmail?: string) => {
  if (ownerName && ownerName.trim()) {
    return ownerName
  }
  if (ownerEmail && ownerEmail.includes('@')) {
    return ownerEmail.split('@')[0]
  }
  return 'Unknown user'
}

const parseRepoPath = (path: string) => {
  const parts = path.split('/')
  if (parts.length < 4) {
    return null
  }

  return {
    ownerUid: parts[1],
    repoId: parts[3],
  }
}

export default function WorkspacePage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(auth?.currentUser ?? null)
  const [repos, setRepos] = useState<RepoRecord[]>([])
  const [repoName, setRepoName] = useState('')
  const [isLoadingRepos, setIsLoadingRepos] = useState(Boolean(auth))
  const [isLoadingInvites, setIsLoadingInvites] = useState(Boolean(auth))
  const [isCreating, setIsCreating] = useState(false)
  const [isJoiningRepoKey, setIsJoiningRepoKey] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [invitedRepos, setInvitedRepos] = useState<InvitedRepoRecord[]>([])

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
    const loadWorkspaceData = async () => {
      if (!db || !user) {
        setRepos([])
        setInvitedRepos([])
        setIsLoadingRepos(false)
        setIsLoadingInvites(false)
        return
      }

      setIsLoadingRepos(true)
      setIsLoadingInvites(true)
      setErrorMessage(null)

      try {
        const repoCollection = collection(db, 'users', user.uid, 'repos')
        const repoQuery = query(repoCollection, orderBy('createdAt', 'desc'))
        const snapshot = await getDocs(repoQuery)
        const nextRepos = snapshot.docs.map((repoDoc) => {
          const data = repoDoc.data() as {
            name?: string
            createdAt?: Timestamp
            role?: 'owner' | 'collaborator'
            ownerName?: string
            ownerUid?: string
            ownerEmail?: string
          }
          return {
            id: repoDoc.id,
            name: data.name ?? 'Untitled Repo',
            createdAt: data.createdAt,
            role: data.role,
            ownerName: data.ownerName,
            ownerUid: data.ownerUid,
            ownerEmail: data.ownerEmail,
          }
        })

        const currentEmail = normalizeEmail(user.email ?? '')
        const hydratedRepos = await Promise.all(
          nextRepos.map(async (repo) => {
            if (
              repo.role !== 'collaborator' ||
              !repo.ownerUid ||
              (repo.ownerName && repo.ownerName.trim()) ||
              (repo.ownerEmail && repo.ownerEmail.trim())
            ) {
              return repo
            }

            let resolvedOwnerName: string | undefined
            let resolvedOwnerEmail: string | undefined

            const ownerRepoDoc = await getDoc(doc(db, 'users', repo.ownerUid, 'repos', repo.id))
            if (ownerRepoDoc.exists()) {
              const ownerRepoData = ownerRepoDoc.data() as {
                ownerName?: string
                ownerEmail?: string
              }
              resolvedOwnerName = ownerRepoData.ownerName
              resolvedOwnerEmail = ownerRepoData.ownerEmail
            }

            if (!resolvedOwnerEmail && currentEmail) {
              const inviteDoc = await getDoc(
                doc(
                  db,
                  'users',
                  repo.ownerUid,
                  'repos',
                  repo.id,
                  'invites',
                  encodeURIComponent(currentEmail)
                )
              )
              if (inviteDoc.exists()) {
                const inviteData = inviteDoc.data() as { invitedByEmail?: string }
                resolvedOwnerEmail = inviteData.invitedByEmail
              }
            }

            if (resolvedOwnerName || resolvedOwnerEmail) {
              await setDoc(
                doc(db, 'users', user.uid, 'repos', repo.id),
                {
                  ownerName: resolvedOwnerName ?? null,
                  ownerEmail: resolvedOwnerEmail ?? null,
                },
                { merge: true }
              )
            }

            return {
              ...repo,
              ownerName: resolvedOwnerName,
              ownerEmail: resolvedOwnerEmail,
            }
          })
        )
        setRepos(hydratedRepos)

        const joinedRepoKeys = new Set(
          hydratedRepos
            .map((repo) => {
              if (!repo.ownerUid) {
                return null
              }
              return `${repo.ownerUid}:${repo.id}`
            })
            .filter((value): value is string => Boolean(value))
        )

        if (currentEmail) {
          const allReposSnapshot = await getDocs(collectionGroup(db, 'repos'))

          const invitedRecords: InvitedRepoRecord[] = []
          for (const repoDoc of allReposSnapshot.docs) {
            const parsed = parseRepoPath(repoDoc.ref.path)
            if (!parsed) {
              continue
            }

            if (parsed.ownerUid === user.uid) {
              continue
            }

            const alreadyJoinedKey = `${parsed.ownerUid}:${parsed.repoId}`
            if (joinedRepoKeys.has(alreadyJoinedKey)) {
              continue
            }

            const inviteDoc = await getDoc(
              doc(
                db,
                'users',
                parsed.ownerUid,
                'repos',
                parsed.repoId,
                'invites',
                encodeURIComponent(currentEmail)
              )
            )

            if (!inviteDoc.exists()) {
              continue
            }

            const inviteData = inviteDoc.data() as { invitedByEmail?: string }
            const repoData = repoDoc.data() as { name?: string; ownerName?: string; ownerEmail?: string }
            const alreadyIncluded = invitedRecords.some(
              (entry) => entry.ownerUid === parsed.ownerUid && entry.id === parsed.repoId
            )
            if (alreadyIncluded) {
              continue
            }

            invitedRecords.push({
              id: parsed.repoId,
              name: repoData.name ?? parsed.repoId,
              ownerName: repoData.ownerName,
              ownerUid: parsed.ownerUid,
              ownerEmail: repoData.ownerEmail ?? inviteData.invitedByEmail,
            })
          }

          setInvitedRepos(invitedRecords)
        } else {
          setInvitedRepos([])
        }
      } catch (error) {
        if (error instanceof Error) {
          setErrorMessage(error.message)
        } else {
          setErrorMessage('Unable to load repos.')
        }
      }

      setIsLoadingRepos(false)
      setIsLoadingInvites(false)
    }

    void loadWorkspaceData()
  }, [user])

  const handleCreateRepo = async () => {
    if (!db || !user) {
      setErrorMessage('You must be logged in to create a repo.')
      return
    }

    setIsCreating(true)
    setErrorMessage(null)

    const trimmedName = repoName.trim()
    const repoId = `repo-${crypto.randomUUID().slice(0, 8)}`

    try {
      await setDoc(doc(db, 'users', user.uid, 'repos', repoId), {
        name: trimmedName || 'Untitled Repo',
        role: 'owner',
        ownerName: user.displayName ?? null,
        ownerUid: user.uid,
        ownerEmail: normalizeEmail(user.email ?? ''),
        createdAt: serverTimestamp(),
      })

      setRepoName('')
      const reloadedRepos = await getDocs(
        query(collection(db, 'users', user.uid, 'repos'), orderBy('createdAt', 'desc'))
      )
      setRepos(
        reloadedRepos.docs.map((repoDoc) => {
          const data = repoDoc.data() as { name?: string; createdAt?: Timestamp }
          return {
            id: repoDoc.id,
            name: data.name ?? 'Untitled Repo',
            createdAt: data.createdAt,
          }
        })
      )
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('Unable to create repo.')
      }
    }

    setIsCreating(false)
  }

  const handleJoinRepo = async (repo: InvitedRepoRecord) => {
    if (!db || !user) {
      setErrorMessage('You must be logged in to join a repo.')
      return
    }

    const repoKey = `${repo.ownerUid}:${repo.id}`
    setIsJoiningRepoKey(repoKey)
    setErrorMessage(null)

    try {
      await setDoc(
        doc(db, 'users', user.uid, 'repos', repo.id),
        {
          name: repo.name,
          role: 'collaborator',
          ownerName: repo.ownerName ?? null,
          ownerUid: repo.ownerUid,
          ownerEmail: repo.ownerEmail ?? null,
          createdAt: serverTimestamp(),
          joinedAt: serverTimestamp(),
        },
        { merge: true }
      )

      setRepos((prevRepos) => [
        {
          id: repo.id,
          name: repo.name,
          role: 'collaborator',
          ownerName: repo.ownerName,
          ownerUid: repo.ownerUid,
          ownerEmail: repo.ownerEmail,
        },
        ...prevRepos.filter((entry) => !(entry.id === repo.id && entry.ownerUid === repo.ownerUid)),
      ])
      setInvitedRepos((prevInvited) =>
        prevInvited.filter((entry) => !(entry.id === repo.id && entry.ownerUid === repo.ownerUid))
      )
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('Unable to join repo.')
      }
    }

    setIsJoiningRepoKey(null)
  }

  return (
    <main className="flex-1 flex flex-col">
      <Navbar />
      <section className="p-6 max-w-3xl w-full mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Workspace Repos</h1>
        <p className="text-sm text-gray-600 mb-6">
          Create a repo and open an editor linked to that repo ID.
        </p>

        <div className="border border-black/10 rounded-xl p-4 mb-6">
          <label htmlFor="repo-name" className="block text-sm mb-2">
            Repo name
          </label>
          <div className="flex gap-2">
            <input
              id="repo-name"
              type="text"
              value={repoName}
              onChange={(event) => setRepoName(event.target.value)}
              placeholder="My collaborative repo"
              className="flex-1 border border-black/20 rounded-md px-3 py-2"
            />
            <button
              type="button"
              onClick={handleCreateRepo}
              disabled={isCreating || !user}
              className="bg-black text-white rounded-md px-4 py-2 disabled:opacity-60"
            >
              {isCreating ? 'Creating...' : 'Create repo'}
            </button>
          </div>
        </div>

        {errorMessage ? <p className="text-sm text-red-500 mb-4">{errorMessage}</p> : null}

        {isLoadingRepos ? (
          <p className="text-sm text-gray-500">Loading repos...</p>
        ) : repos.length === 0 ? (
          <p className="text-sm text-gray-500">No repos yet. Create your first repo above.</p>
        ) : (
          <ul className="space-y-3">
            {repos.map((repo) => (
              <li key={repo.id} className="border border-black/10 rounded-lg p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{repo.name}</p>
                    <p className="text-xs text-gray-500 mt-1">ID: {repo.id}</p>
                    {repo.role === 'collaborator' ? (
                      <p className="text-xs text-gray-500 mt-1">
                        Collaborator, owned by: {getOwnerLabel(repo.ownerName, repo.ownerEmail)}
                      </p>
                    ) : null}
                    <p className="text-xs text-gray-500 mt-1">
                      Created: {repo.createdAt ? repo.createdAt.toDate().toLocaleString() : 'just now'}
                    </p>
                  </div>
                  <Link
                    href={`/repo/${repo.id}`}
                    className="border border-black/20 rounded-md px-3 py-2 text-sm"
                  >
                    Open editor
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-2">Invited Repos</h2>
          {isLoadingInvites ? (
            <p className="text-sm text-gray-500">Loading invitations...</p>
          ) : invitedRepos.length === 0 ? (
            <p className="text-sm text-gray-500">No invitations yet.</p>
          ) : (
            <ul className="space-y-3">
              {invitedRepos.map((repo) => (
                <li key={`${repo.ownerUid}-${repo.id}`} className="border border-black/10 rounded-lg p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{repo.name}</p>
                      <p className="text-xs text-gray-500 mt-1">ID: {repo.id}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Owned by: {getOwnerLabel(repo.ownerName, repo.ownerEmail)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleJoinRepo(repo)}
                      disabled={isJoiningRepoKey === `${repo.ownerUid}:${repo.id}`}
                      className="border border-black/20 rounded-md px-3 py-2 text-sm"
                    >
                      {isJoiningRepoKey === `${repo.ownerUid}:${repo.id}` ? 'Joining...' : 'Join'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  )
}
