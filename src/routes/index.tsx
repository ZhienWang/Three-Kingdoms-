import { useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { api } from '@/convex/_generated/api'
import { HERO_IDS, HEROES, KINGDOM_LABEL } from '@/convex/game/defs'
import type { Kingdom } from '@/convex/game/defs'
import { GameCard, HeroCard } from '@/components/game/cards'
import { Toaster } from '@/components/ui/sonner'
import { errorText, useIdentity } from '@/lib/game-ui'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({ component: Home })

const KINGDOMS: Kingdom[] = ['shu', 'wei', 'wu', 'qun']

function Home() {
  const id = useIdentity()
  const navigate = useNavigate()
  const create = useMutation(api.rooms.create)
  const join = useMutation(api.rooms.join)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)
  const [kingdom, setKingdom] = useState<Kingdom>('shu')

  async function onCreate() {
    if (!id.token) return
    setBusy('create')
    try {
      const c = await create({ token: id.token, name: id.name })
      navigate({ to: '/room', search: { code: c } })
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  async function onJoin(e: React.FormEvent) {
    e.preventDefault()
    if (!id.token) return
    setBusy('join')
    try {
      const r = await join({ code, token: id.token, name: id.name })
      navigate({ to: '/room', search: { code: r.code } })
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="table-felt min-h-dvh text-rice">
      <main className="mx-auto grid max-w-6xl gap-10 px-5 pb-16 pt-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:pt-16">
        <section>
          <p className="font-brush text-6xl leading-none text-gold sm:text-7xl">三国 决斗</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-5xl">Three Kingdoms Duel</h1>
          <p className="mt-4 max-w-[34rem] text-lg leading-relaxed text-rice-dim">
            A hidden-role card battle for 2 to 8 friends, played face to face over live video. The Lord and Loyalists hold the realm.
            Rebels want the Lord gone. The Spy wants to be the last one standing.
          </p>

          <div className="mt-8 max-w-md rounded-xl bg-jade/90 p-5 gilt">
            <label htmlFor="name" className="mb-1 block text-sm text-rice-dim">
              Your name at the table
            </label>
            <input
              id="name"
              value={id.name}
              onChange={(e) => id.setName(e.target.value)}
              maxLength={24}
              placeholder="e.g. Kongming"
              className="mb-4 w-full rounded-md bg-jade-deep px-3 py-2 text-rice placeholder:text-rice-dim/70"
            />
            <button
              type="button"
              onClick={onCreate}
              disabled={!id.ready || !id.name.trim() || busy !== null}
              className="w-full rounded-md bg-cinnabar px-4 py-2.5 text-lg font-semibold text-rice transition hover:bg-cinnabar-bright disabled:opacity-40"
            >
              {busy === 'create' ? 'Creating room…' : 'Create a room'}
            </button>
            <form onSubmit={onJoin} className="mt-4 flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={5}
                placeholder="Room code"
                aria-label="Room code"
                className="min-w-0 flex-1 rounded-md bg-jade-deep px-3 py-2 tracking-[0.15em] text-rice placeholder:tracking-normal placeholder:text-rice-dim/70"
              />
              <button
                type="submit"
                disabled={!id.ready || !id.name.trim() || code.length < 5 || busy !== null}
                className="rounded-md bg-jade-soft px-4 py-2 font-semibold text-rice disabled:opacity-40"
              >
                Join
              </button>
            </form>
            {!id.name.trim() && <p className="mt-3 text-sm text-rice-dim">Enter your name to create or join a room.</p>}
            <div className="mt-5 border-t border-gold/25 pt-4">
              <Link
                to="/solo"
                className="block w-full rounded-md border border-gold/60 px-4 py-2.5 text-center font-semibold text-gold transition hover:bg-gold hover:text-ink"
              >
                Play solo against the AI
              </Link>
              <p className="mt-2 text-sm text-rice-dim">No camera or friends needed. 1 to 7 AI opponents.</p>
            </div>
          </div>
        </section>

        <section aria-hidden className="relative mx-auto h-[360px] w-full max-w-[420px] sm:h-[420px]">
          <div className="absolute left-[6%] top-[14%] -rotate-[14deg]">
            <GameCard name="dodge" width={170} />
          </div>
          <div className="absolute right-[6%] top-[14%] rotate-[12deg]">
            <GameCard name="peach" width={170} />
          </div>
          <div className="absolute left-1/2 top-0 -translate-x-1/2">
            <GameCard name="attack" width={196} />
          </div>
        </section>
      </main>

      <section className="border-t border-gold/20 bg-jade-deep/70">
        <div className="mx-auto max-w-6xl px-5 py-12">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-3xl font-semibold">Sixteen heroes, four kingdoms</h2>
              <p className="mt-1 max-w-[36rem] text-rice-dim">Each hero bends the rules in one way. Pick from a few at the start of every game.</p>
            </div>
            <div className="flex gap-1 rounded-lg bg-jade p-1" role="tablist" aria-label="Kingdom">
              {KINGDOMS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={kingdom === k}
                  onClick={() => setKingdom(k)}
                  className={cn('rounded-md px-3 py-1.5 text-sm', kingdom === k ? 'bg-rice text-ink' : 'text-rice-dim hover:text-rice')}
                >
                  {KINGDOM_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-3">
            {HERO_IDS.filter((h) => HEROES[h].kingdom === kingdom).map((h) => (
              <HeroCard key={h} hero={h} width={210} />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <h2 className="text-3xl font-semibold">How a turn goes</h2>
        <ol className="mt-5 grid gap-5 text-rice-dim sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Judgement', 'Delayed tricks on you resolve: Indulgence may cost you your play phase, Lightning may strike.'],
            ['Draw', 'Take two cards from the deck.'],
            ['Play', 'Use cards and skills. One Attack per turn unless something lets you do more.'],
            ['Discard', 'Keep no more cards than your current HP.'],
          ].map(([t, d], i) => (
            <li key={t} className="border-l-2 border-gold/50 pl-4">
              <span className="font-brush text-2xl text-gold">{['一', '二', '三', '四'][i]}</span>
              <h3 className="text-lg font-semibold text-rice">{t}</h3>
              <p className="leading-relaxed">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-t border-gold/20 px-5 py-6 text-center text-sm text-rice-dim">
        All artwork is public domain or CC0, from Qing-era and Edo-period prints and paintings.{' '}
        <Link to="/credits" className="text-gold underline underline-offset-2">
          See art credits
        </Link>
        .
      </footer>
      <Toaster position="top-center" richColors />
    </div>
  )
}
