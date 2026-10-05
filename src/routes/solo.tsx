import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { MAX_PLAYERS, ROLE_LABEL, rolesFor } from '@/convex/game/defs'
import { answer, createGame, pickHero, timeout, viewFor } from '@/convex/game/engine'
import type { Answer, Game } from '@/convex/game/engine'
import { BOT_NAMES, botDecide, chooseHeroFor, fallbackAnswer, newMemory, observe } from '@/convex/game/bot'
import type { BotMemory } from '@/convex/game/bot'
import { GameTable } from '@/components/game/table'
import { Toaster } from '@/components/ui/sonner'
import { useIdentity } from '@/lib/game-ui'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/solo')({ component: SoloPage })

const ME = 'you'
const SAVE_KEY = 'tkd.solo.v1'
type Speed = 'relaxed' | 'normal' | 'fast'
const DELAYS: Record<Speed, { play: number; other: number }> = {
  relaxed: { play: 1600, other: 1100 },
  normal: { play: 950, other: 650 },
  fast: { play: 350, other: 220 },
}

interface Saved {
  game: Game
  mem: Record<string, BotMemory>
  speed: Speed
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Saved
    return s.game?.players?.length ? s : null
  } catch {
    return null
  }
}
function save(s: Saved | null) {
  try {
    if (s) localStorage.setItem(SAVE_KEY, JSON.stringify(s))
    else localStorage.removeItem(SAVE_KEY)
  } catch {
    // Storage can be unavailable (private mode); the game still works in memory.
  }
}

function SoloPage() {
  const id = useIdentity()
  const [mounted, setMounted] = useState(false)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [speed, setSpeed] = useState<Speed>('normal')
  const mem = useRef<Record<string, BotMemory>>({})
  const gameRef = useRef<Game | null>(null)
  gameRef.current = game

  useEffect(() => {
    setMounted(true)
    setSaved(load())
  }, [])

  const commit = useCallback(
    (g: Game) => {
      for (const p of g.players) if (p.id !== ME) observe(g, mem.current[p.id])
      setGame(g)
      save(g.phase === 'over' ? null : { game: g, mem: mem.current, speed })
    },
    [speed],
  )

  function start(opponents: number) {
    const people = [{ id: ME, name: id.name.trim() || 'You' }, ...BOT_NAMES.slice(0, opponents).map((n, i) => ({ id: 'bot' + i, name: `${n} (AI)` }))]
    const now = Date.now()
    const g = createGame(people, now)
    mem.current = {}
    for (const p of g.players) {
      if (p.id === ME) continue
      mem.current[p.id] = newMemory()
      pickHero(g, p.id, chooseHeroFor(g, p.id), now)
    }
    commit(structuredClone(g))
  }

  function resume(s: Saved) {
    mem.current = s.mem
    setSpeed(s.speed)
    setGame(s.game)
  }

  // Bots take their turns (and answer prompts) after a short, readable delay.
  useEffect(() => {
    if (!game || game.phase !== 'playing' || !game.prompt) return
    const pr = game.prompt
    const botId = pr.to.find((pid) => pid !== ME && !pr.passed.includes(pid))
    if (!botId) return
    const delay = pr.kind === 'play' ? DELAYS[speed].play : DELAYS[speed].other
    const t = setTimeout(() => {
      const g = structuredClone(gameRef.current!)
      if (!g.prompt || g.prompt.id !== pr.id) return
      const m = mem.current[botId] ?? (mem.current[botId] = newMemory())
      let err = answer(g, botId, pr.id, botDecide(g, botId, m), Date.now())
      if (err) {
        const fb = fallbackAnswer(g)
        err = fb ? answer(g, botId, pr.id, fb, Date.now()) : 'no fallback'
        if (err) timeout(g, pr.id, pr.deadline + 1000)
      }
      commit(g)
    }, delay)
    return () => clearTimeout(t)
  }, [game, speed, commit])

  if (!mounted || !id.ready) {
    return <div className="table-felt min-h-dvh" />
  }

  if (!game) {
    return <Setup saved={saved} speed={speed} setSpeed={setSpeed} onStart={start} onResume={resume} defaultName={id.name} />
  }

  const view = viewFor(game, ME)
  return (
    <>
      <GameTable
        view={view}
        controls={{
          title: (
            <>
              Single player{' '}
              <span className="ml-2 inline-flex gap-1 align-middle">
                {(['relaxed', 'normal', 'fast'] as Speed[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeed(s)}
                    aria-pressed={speed === s}
                    className={cn('rounded px-1.5 py-0.5 text-xs', speed === s ? 'bg-rice text-ink' : 'bg-jade-soft text-rice-dim')}
                  >
                    {s === 'relaxed' ? 'Slow AI' : s === 'normal' ? 'Normal' : 'Fast AI'}
                  </button>
                ))}
              </span>
            </>
          ),
          isHost: true,
          mesh: null,
          showTimers: false,
          act: async (promptId: number, a: Answer) => {
            const g = structuredClone(gameRef.current!)
            const err = answer(g, ME, promptId, a, Date.now())
            if (!err) commit(g)
            return err
          },
          chooseHero: async (hero) => {
            const g = structuredClone(gameRef.current!)
            const err = pickHero(g, ME, hero, Date.now())
            if (err) throw new Error(err)
            commit(g)
          },
          onLobby: () => {
            save(null)
            setSaved(null)
            setGame(null)
          },
          lobbyLabel: 'New game',
          chat: null,
        }}
      />
      <Toaster position="top-center" richColors />
    </>
  )
}

function Setup({
  saved,
  speed,
  setSpeed,
  onStart,
  onResume,
  defaultName,
}: {
  saved: Saved | null
  speed: Speed
  setSpeed: (s: Speed) => void
  onStart: (opponents: number) => void
  onResume: (s: Saved) => void
  defaultName: string
}) {
  const [opponents, setOpponents] = useState(4)
  const roles = rolesFor(opponents + 1)
  const counts = roles.reduce<Record<string, number>>((a, r) => ((a[r] = (a[r] ?? 0) + 1), a), {})
  return (
    <div className="table-felt min-h-dvh px-5 py-10 text-rice">
      <div className="mx-auto max-w-xl">
        <Link to="/" className="font-brush text-3xl text-gold">
          三国
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">Play against the AI</h1>
        <p className="mt-2 leading-relaxed text-rice-dim">
          Same rules as an online table. Your role is dealt at random, and the AI players only know what you would know: the
          Lord, and what everyone has done so far.
          {!defaultName.trim() && ' You will appear as "You".'}
        </p>

        {saved && (
          <div className="mt-6 rounded-xl bg-jade p-4 gilt">
            <p className="text-rice">
              You have a game in progress: turn {saved.game.turn} with {saved.game.players.length - 1} AI players.
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => onResume(saved)} className="rounded-md bg-cinnabar px-4 py-2 font-semibold text-rice hover:bg-cinnabar-bright">
                Resume game
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 rounded-xl bg-jade/90 p-5 gilt">
          <h2 className="text-lg font-semibold">AI opponents</h2>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Number of AI opponents">
            {Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={opponents === n}
                onClick={() => setOpponents(n)}
                className={cn('size-10 rounded-md text-lg font-semibold', opponents === n ? 'bg-rice text-ink' : 'bg-jade-deep text-rice hover:bg-jade-soft')}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm text-rice-dim">
            {opponents + 1} players:{' '}
            {Object.entries(counts)
              .map(([r, c]) => `${c} ${ROLE_LABEL[r as keyof typeof ROLE_LABEL]}${c > 1 ? 's' : ''}`)
              .join(', ')}
            .
          </p>

          <h2 className="mt-5 text-lg font-semibold">AI speed</h2>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="AI speed">
            {(['relaxed', 'normal', 'fast'] as Speed[]).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={speed === s}
                onClick={() => setSpeed(s)}
                className={cn('rounded-md px-3 py-2', speed === s ? 'bg-rice text-ink' : 'bg-jade-deep text-rice hover:bg-jade-soft')}
              >
                {s === 'relaxed' ? 'Slow' : s === 'normal' ? 'Normal' : 'Fast'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onStart(opponents)}
            className="mt-6 w-full rounded-md bg-cinnabar px-4 py-3 text-lg font-semibold text-rice hover:bg-cinnabar-bright"
          >
            {saved ? 'Start a new game' : 'Deal roles and start'}
          </button>
          {saved && <p className="mt-2 text-sm text-rice-dim">Starting a new game replaces the one in progress.</p>}
        </div>
      </div>
    </div>
  )
}
