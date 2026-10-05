import { useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'
import type { FunctionReturnType } from 'convex/server'
import { api } from '@/convex/_generated/api'
import { MAX_PLAYERS, MIN_PLAYERS, rolesFor, ROLE_LABEL } from '@/convex/game/defs'
import { useVideoMesh } from '@/hooks/use-video-mesh'
import type { VideoMesh } from '@/hooks/use-video-mesh'
import { errorText, useIdentity } from '@/lib/game-ui'
import { cn } from '@/lib/utils'
import { GameTable, MediaButtons } from '@/components/game/table'
import { VideoTile } from '@/components/game/video'
import { Toaster } from '@/components/ui/sonner'

const INITIAL_CODE = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('code') : null

export const Route = createFileRoute('/room')({
  validateSearch: (s: Record<string, unknown>) => ({ code: typeof s.code === 'string' ? s.code.toUpperCase() : '' }),
  component: RoomPage,
})

function RoomPage() {
  const search = Route.useSearch()
  // The page is prerendered without search params, and hydration can reset them,
  // so fall back to the code captured from the real URL when this module loaded.
  const [code, setCode] = useState(search.code)
  useEffect(() => {
    const c = (search.code || INITIAL_CODE || '').toUpperCase()
    setCode(c)
    if (c && !new URLSearchParams(window.location.search).get('code')) {
      window.history.replaceState(window.history.state, '', `/room?code=${c}`)
    }
  }, [search.code])
  const id = useIdentity()
  const room = useQuery(api.rooms.get, id.token && code ? { code, token: id.token } : 'skip')
  const mesh = useVideoMesh(room?.roomId ?? null, id.token, room?.me ?? null)

  let body: React.ReactNode
  if (!id.ready || (code && room === undefined)) {
    body = <Centered>Opening the room…</Centered>
  } else if (!code || room === null) {
    body = (
      <Centered>
        <p className="mb-4 text-lg text-rice">There is no room with the code {code || '(none)'}.</p>
        <Link to="/" className="rounded-md bg-cinnabar px-4 py-2 font-semibold text-rice">
          Create or join a room
        </Link>
      </Centered>
    )
  } else if (room && !room.me && room.status === 'lobby') {
    body = <JoinForm code={room.code} id={id} />
  } else if (room && room.status === 'lobby') {
    body = <Lobby room={room} token={id.token!} mesh={mesh} />
  } else if (room) {
    body = (
      <>
        {!room.me && <p className="bg-gold px-3 py-1.5 text-center text-sm text-ink">This game is in progress. You are watching.</p>}
        <OnlineTable room={room} token={id.token!} mesh={mesh} />
      </>
    )
  }
  return (
    <>
      {body}
      <Toaster position="top-center" richColors />
    </>
  )
}

function OnlineTable({ room, token, mesh }: { room: Room; token: string; mesh: VideoMesh }) {
  const act = useMutation(api.rooms.act)
  const chooseHero = useMutation(api.rooms.chooseHero)
  const backToLobby = useMutation(api.rooms.backToLobby)
  return (
    <GameTable
      view={room.view!}
      controls={{
        title: (
          <>
            Room <span className="font-semibold tracking-wider text-rice">{room.code}</span>
          </>
        ),
        isHost: room.me === room.hostPid,
        mesh,
        act: async (promptId, answer) => {
          const res = await act({ roomId: room.roomId, token, promptId, answer })
          return res?.error ?? null
        },
        chooseHero: async (hero) => {
          await chooseHero({ roomId: room.roomId, token, hero })
        },
        onLobby: () => {
          backToLobby({ roomId: room.roomId, token }).catch((e) => toast.error(errorText(e)))
        },
        chat: { roomId: room.roomId, token, canSend: !!room.me },
      }}
    />
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="table-felt flex min-h-dvh flex-col items-center justify-center p-6 text-center text-rice-dim">{children}</div>
}

function JoinForm({ code, id }: { code: string; id: ReturnType<typeof useIdentity> }) {
  const join = useMutation(api.rooms.join)
  const [name, setName] = useState(id.name)
  const [busy, setBusy] = useState(false)
  return (
    <Centered>
      <form
        className="w-full max-w-sm rounded-xl bg-jade p-6 text-left gilt"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            id.setName(name)
            await join({ code, token: id.token!, name })
          } catch (err) {
            toast.error(errorText(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        <h1 className="mb-1 text-2xl font-semibold text-rice">Join room {code}</h1>
        <p className="mb-4 text-rice-dim">Pick the name the others will see at the table.</p>
        <label className="mb-1 block text-sm text-rice-dim" htmlFor="join-name">
          Your name
        </label>
        <input
          id="join-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
          required
          autoFocus
          className="mb-4 w-full rounded-md bg-jade-deep px-3 py-2 text-rice"
        />
        <button type="submit" disabled={busy} className="w-full rounded-md bg-cinnabar px-4 py-2 font-semibold text-rice hover:bg-cinnabar-bright disabled:opacity-50">
          Join the table
        </button>
      </form>
    </Centered>
  )
}

type Room = NonNullable<FunctionReturnType<typeof api.rooms.get>>

function Lobby({ room, token, mesh }: { room: Room; token: string; mesh: VideoMesh }) {
  const start = useMutation(api.rooms.start)
  const leave = useMutation(api.rooms.leave)
  const navigate = useNavigate()
  const isHost = room.me === room.hostPid
  const n = room.members.length
  const [copied, setCopied] = useState(false)
  const link = typeof window !== 'undefined' ? `${window.location.origin}/room?code=${room.code}` : ''
  const roles = n >= MIN_PLAYERS ? rolesFor(n) : []
  const roleCounts = roles.reduce<Record<string, number>>((a, r) => ((a[r] = (a[r] ?? 0) + 1), a), {})

  return (
    <div className="table-felt min-h-dvh px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link to="/" className="font-brush text-3xl text-gold">
              三国
            </Link>
            <h1 className="text-3xl font-semibold text-rice">
              Room <span className="tracking-[0.12em]">{room.code}</span>
            </h1>
            <p className="text-rice-dim">
              {n} of {MAX_PLAYERS} seats taken.{' '}
              {roles.length > 0 &&
                `Roles for ${n}: ` +
                  Object.entries(roleCounts)
                    .map(([r, c]) => `${c} ${ROLE_LABEL[r as keyof typeof ROLE_LABEL]}${c > 1 ? 's' : ''}`)
                    .join(', ') +
                  '.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(link)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              className="rounded-md bg-jade-soft px-3 py-2 text-sm text-rice"
            >
              {copied ? 'Link copied' : 'Copy invite link'}
            </button>
            <MediaButtons mesh={mesh} />
          </div>
        </div>
        {mesh.mediaError && <p className="mb-4 rounded-md bg-cinnabar/90 px-3 py-2 text-sm text-rice">{mesh.mediaError}</p>}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {room.members.map((m) => {
            const isMe = m.pid === room.me
            const online = isMe || mesh.online.has(m.pid)
            return (
              <div key={m.pid} className={cn('overflow-hidden rounded-lg bg-ink ring-2', m.pid === room.hostPid ? 'ring-gold' : 'ring-jade-soft')}>
                <VideoTile
                  stream={isMe ? mesh.local : mesh.remote[m.pid]}
                  muted={isMe}
                  mirrored={isMe}
                  visible={isMe ? mesh.camOn && !!mesh.local : !!mesh.cameraFlags[m.pid] && !!mesh.remote[m.pid]}
                  className="aspect-[4/3] w-full"
                  fallback={
                    <div className="flex h-full w-full items-center justify-center bg-jade">
                      <span className="font-brush text-5xl text-rice/60">{m.name.slice(0, 1)}</span>
                    </div>
                  }
                />
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="truncate font-semibold text-rice">
                    {m.name}
                    {isMe && <span className="font-normal text-rice-dim"> (you)</span>}
                  </span>
                  <span className={cn('text-xs', online ? 'text-wu' : 'text-rice-dim')}>
                    {m.pid === room.hostPid ? 'host' : online ? 'here' : 'away'}
                  </span>
                </div>
              </div>
            )
          })}
          {Array.from({ length: Math.max(0, Math.min(MAX_PLAYERS, 4) - n) }, (_, i) => (
            <div key={i} className="flex aspect-[4/3] items-center justify-center rounded-lg border border-dashed border-rice/25 text-sm text-rice-dim">
              Open seat
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {isHost ? (
            <button
              type="button"
              disabled={n < MIN_PLAYERS}
              onClick={() => start({ roomId: room.roomId, token }).catch((e) => toast.error(errorText(e)))}
              className="rounded-md bg-cinnabar px-6 py-3 text-lg font-semibold text-rice hover:bg-cinnabar-bright disabled:opacity-40"
            >
              Deal roles and start
            </button>
          ) : (
            <p className="text-rice-dim">Waiting for the host to start the game.</p>
          )}
          {n < MIN_PLAYERS && <p className="text-rice-dim">Share the link: you need at least {MIN_PLAYERS} players.</p>}
          <button
            type="button"
            onClick={async () => {
              await leave({ roomId: room.roomId, token }).catch(() => {})
              navigate({ to: '/' })
            }}
            className="ml-auto rounded-md px-3 py-2 text-sm text-rice-dim hover:text-rice"
          >
            Leave room
          </button>
        </div>
      </div>
    </div>
  )
}
