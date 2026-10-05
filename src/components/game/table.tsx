import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { CARD_INFO, HEROES, ROLE_LABEL, card } from '@/convex/game/defs'
import type { CardName, HeroId } from '@/convex/game/defs'
import { attackRange, distance, provides, validatePlay, weaponOf } from '@/convex/game/engine'
import type { Answer, GameView, Player, ViewPlayer } from '@/convex/game/engine'
import type { VideoMesh } from '@/hooks/use-video-mesh'
import { HERO_CJK, errorText } from '@/lib/game-ui'
import { cn } from '@/lib/utils'
import { CardBack, GameCard, HeroCard } from './cards'
import { HpPips, Seat } from './seat'

/** Where the table's decisions go: a Convex room, or a local single-player game. */
export interface TableControls {
  title: React.ReactNode
  isHost: boolean
  mesh?: VideoMesh | null
  showTimers?: boolean
  act: (promptId: number, answer: Answer) => Promise<string | null>
  chooseHero: (hero: HeroId) => Promise<void>
  onLobby: () => void
  lobbyLabel?: string
  chat?: { roomId: Id<'rooms'>; token: string; canSend: boolean } | null
}

const PHASE_LABEL: Record<GameView['turnPhase'], string> = {
  start: 'Start',
  judge: 'Judgement',
  draw: 'Draw',
  play: 'Play',
  discard: 'Discard',
  end: 'End',
}

function Countdown({ deadline, show = true }: { deadline: number; show?: boolean }) {
  if (!show) return null
  return <CountdownInner deadline={deadline} />
}

function CountdownInner({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  const left = Math.max(0, Math.ceil((deadline - now) / 1000))
  return (
    <span className={cn('tabular-nums', left <= 5 ? 'text-cinnabar-bright' : 'text-rice-dim')} aria-label={`${left} seconds left`}>
      {left}s
    </span>
  )
}

function Btn({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'quiet' | 'gold'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-md px-4 py-2 text-[15px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'primary' && 'bg-cinnabar text-rice hover:bg-cinnabar-bright',
        variant === 'gold' && 'bg-gold text-ink hover:brightness-110',
        variant === 'quiet' && 'bg-jade-soft text-rice hover:bg-jade-soft/80',
      )}
    >
      {children}
    </button>
  )
}

export function GameTable({ view, controls }: { view: GameView; controls: TableControls }) {
  const { mesh, isHost } = controls
  const timers = controls.showTimers !== false

  const me = view.players.find((p) => p.id === view.me) ?? null
  const pr = view.prompt
  const mine = !!pr?.mine
  const current = view.players[view.current]

  const [sel, setSel] = useState<number[]>([])
  const [targets, setTargets] = useState<string[]>([])
  const [skill, setSkill] = useState<string | null>(null)
  const [asAttack, setAsAttack] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showOver, setShowOver] = useState(true)
  const [panel, setPanel] = useState(false)

  useEffect(() => {
    setSel([])
    setTargets([])
    setSkill(null)
    setAsAttack(false)
  }, [pr?.id])

  // Flash a seat red when its HP drops.
  const prevHp = useRef<Record<string, number>>({})
  const [hits, setHits] = useState<Record<string, number>>({})
  useEffect(() => {
    const changed: Record<string, number> = {}
    for (const p of view.players) {
      const before = prevHp.current[p.id]
      if (before != null && p.hp < before) changed[p.id] = Date.now()
      prevHp.current[p.id] = p.hp
    }
    if (Object.keys(changed).length) setHits((h) => ({ ...h, ...changed }))
  }, [view.players])

  // A full-shape copy of players so the shared validation code can run here.
  const shim = useMemo(
    () =>
      view.players.map(
        (p) =>
          ({
            ...p,
            hand: p.hand ?? Array.from({ length: p.handCount }, () => -1),
            role: p.role ?? 'rebel',
            heroChoices: [],
          }) as Player,
      ),
    [view.players],
  )
  const meFull = me ? shim.find((p) => p.id === me.id)! : null
  const myTurn = !!me && current?.id === me.id

  async function send(answer: Answer) {
    if (!pr) return
    setBusy(true)
    try {
      const err = await controls.act(pr.id, answer)
      if (err) toast.error(err)
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------------------- derive intent
  const playMode = mine && pr?.kind === 'play'
  const respondMode = mine && pr?.kind === 'respond'
  const discardMode = mine && pr?.kind === 'discard'
  const targetsMode = mine && pr?.kind === 'targets'

  let intent: { name: CardName; as?: CardName } | null = null
  if (playMode && !skill && meFull && sel.length) {
    if (sel.length === 2) intent = { name: 'attack', as: 'attack' }
    else {
      const c = card(sel[0])
      if (asAttack || (me?.hero === 'zhaoyun' && c.name === 'dodge')) intent = { name: 'attack', as: 'attack' }
      else intent = { name: c.name }
    }
  }
  const halberd = meFull && weaponOf(meFull) === 'halberd' && sel.length === meFull.hand.length
  const targetMax = (() => {
    if (skill === 'benevolence' || skill === 'salve') return 1
    if (!intent) return 0
    if (intent.name === 'attack') return halberd ? 3 : 1
    return ['duel', 'dismantle', 'steal', 'indulgence'].includes(intent.name) ? 1 : 0
  })()

  const playCheck = intent && meFull ? validatePlay({ players: shim }, meFull, sel, intent.as, targets) : null
  const playError = playCheck && 'error' in playCheck ? playCheck.error : null

  function canTarget(pid: string): boolean {
    if (!me || !meFull) return false
    const p = view.players.find((x) => x.id === pid)!
    if (!p.alive) return false
    if (targetsMode) return (pr!.data.eligible as string[]).includes(pid)
    if (!playMode) return false
    if (skill === 'benevolence') return pid !== me.id
    if (skill === 'salve') return p.hp < p.maxHp
    if (!intent || targetMax === 0) return false
    if (targets.includes(pid)) return true
    const trial = targetMax > 1 && targets.length < targetMax ? [...targets, pid] : [pid]
    const r = validatePlay({ players: shim }, meFull, sel, intent.as, trial)
    return !('error' in r)
  }

  function clickSeat(pid: string) {
    if (!canTarget(pid)) return
    const max = targetsMode ? pr!.data.max : targetMax
    setTargets((t) => (t.includes(pid) ? t.filter((x) => x !== pid) : max > 1 ? [...t, pid].slice(-max) : [pid]))
  }

  const respondNeed: CardName | null = respondMode ? pr!.data.need : null
  const serpent = meFull && weaponOf(meFull) === 'serpentspear'
  const respondValid = !!(respondNeed && meFull && provides(meFull, sel, respondNeed, myTurn))

  const discardPool: number[] = discardMode
    ? [...(me?.hand ?? []), ...(pr!.data.allowEquip ? (Object.values(me!.equip).filter((v) => v != null) as number[]) : [])].filter(
        (c) => !(pr!.data.exclude ?? []).includes(c),
      )
    : []

  function clickCard(id: number) {
    if (!pr || !mine) return
    if (playMode) {
      if (skill === 'benevolence' || skill === 'balance') return setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
      if (skill === 'salve') return setSel([id])
      setTargets([])
      setAsAttack(false)
      setSel((s) => {
        if (s.includes(id)) return s.filter((x) => x !== id)
        if (serpent && s.length === 1) return [...s, id]
        return [id]
      })
      return
    }
    if (respondMode) {
      setSel((s) => {
        if (s.includes(id)) return s.filter((x) => x !== id)
        if (respondNeed === 'attack' && serpent && s.length === 1) return [...s, id]
        return [id]
      })
      return
    }
    if (discardMode) {
      setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < pr.data.count ? [...s, id] : s))
    }
  }

  function cardDimmed(id: number): boolean {
    if (!pr || !mine || !meFull) return false
    const c = card(id)
    if (playMode && !skill) {
      if (c.name === 'negate') return true
      if (c.name === 'dodge' && me?.hero !== 'zhaoyun') return true
      if (c.name === 'peach' && me!.hp >= me!.maxHp) return true
      return false
    }
    if (respondMode && respondNeed) {
      if (respondNeed === 'attack' && serpent) return false
      return !provides(meFull, [id], respondNeed, myTurn)
    }
    if (discardMode) return !discardPool.includes(id)
    return false
  }

  const activeSkills = me?.hero ? HEROES[me.hero].skills.filter((s) => s.active) : []
  function skillUsable(id: string) {
    if (!me) return false
    if (id === 'balance') return !me.flags.balance
    if (id === 'salve') return !me.flags.salve && (me.hand?.length ?? 0) > 0
    if (id === 'benevolence') return (me.hand?.length ?? 0) > 0
    return true
  }

  // ---------------------------------------------------------- hero select
  if (view.phase === 'heroSelect') {
    const lord = view.players.find((p) => p.role === 'lord')
    return (
      <div className="table-felt min-h-dvh px-4 py-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-1 flex items-baseline justify-between gap-4">
            <h1 className="text-2xl font-semibold text-rice">Choose your hero</h1>
            <Countdown deadline={view.heroDeadline} show={timers} />
          </div>
          {me?.role && (
            <p className="mb-5 text-rice-dim">
              You are the <span className="font-semibold text-gold">{ROLE_LABEL[me.role]}</span>
              {me.role === 'lord' && '. Everyone can see your role, and you get +1 max HP.'}
              {me.role === 'loyalist' && '. Keep the Lord alive and help defeat the Rebels and the Spy.'}
              {me.role === 'rebel' && '. Defeat the Lord.'}
              {me.role === 'spy' && '. Be the last one standing, with the Lord defeated last.'}
              {lord?.hero && me.role !== 'lord' && <> The Lord, {lord.name}, plays {HEROES[lord.hero].name}.</>}
            </p>
          )}
          {me && !me.hero && me.heroChoices ? (
            <div className="flex flex-wrap gap-4">
              {me.heroChoices.map((h) => (
                <HeroCard
                  key={h}
                  hero={h}
                  width={190}
                  onClick={() => controls.chooseHero(h).catch((e) => toast.error(errorText(e)))}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-start gap-6">
              {me?.hero && <HeroCard hero={me.hero} width={190} />}
              <div className="text-rice-dim">
                <p className="mb-2">Waiting for the others to choose:</p>
                <ul className="space-y-1">
                  {view.players.map((p) => (
                    <li key={p.id} className="text-rice">
                      {p.name} {p.id === me?.id || p.hero ? <span className="text-wu">ready</span> : <span className="italic text-rice-dim">choosing</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------- layout
  const myIdx = me ? view.players.findIndex((p) => p.id === me.id) : -1
  const seated = myIdx >= 0 ? [...view.players.slice(myIdx + 1), ...view.players.slice(0, myIdx)] : view.players
  // Fallen players no longer occupy a seat, so list them after everyone still at the table.
  const others = [...seated.filter((p) => p.alive), ...seated.filter((p) => !p.alive)]
  const living = seated.filter((p) => p.alive)
  const fallen = seated.filter((p) => !p.alive)
  const waitingOn = new Set(pr?.waitingOn ?? [])
  const lp = view.lastPlay
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? '?'

  const seatFor = (p: ViewPlayer, big = false, compact = false) => {
    const isMe = p.id === me?.id
    const tgt = canTarget(p.id)
    let reach: { distance: number; inAttackRange: boolean; blocked?: string } | undefined
    if (me && me.alive && !isMe && p.alive && view.phase === 'playing') {
      const d = distance(view.players, me.id, p.id)
      reach = { distance: d, inAttackRange: d <= attackRange(me) }
      // With a targeted card selected, say why this seat can't be chosen.
      if (playMode && intent && targetMax > 0 && !tgt && meFull) {
        const r = validatePlay({ players: shim }, meFull, sel, intent.as, [p.id])
        if ('error' in r) reach.blocked = shortReason(r.error)
      }
    }
    return (
      <Seat
        key={p.id}
        p={p}
        isMe={isMe}
        stream={!mesh ? null : isMe ? mesh.local : mesh.remote[p.id]}
        cameraOn={!mesh ? false : isMe ? mesh.camOn : !!mesh.cameraFlags[p.id]}
        connection={!mesh || isMe ? undefined : !mesh.online.has(p.id) ? 'offline' : mesh.status[p.id] ?? 'connecting'}
        isCurrent={current?.id === p.id && view.phase === 'playing'}
        waiting={waitingOn.has(p.id) && !isMe}
        selectable={tgt}
        selected={targets.includes(p.id)}
        hit={!!hits[p.id] && Date.now() - hits[p.id] < 900}
        reach={reach}
        compact={compact}
        onClick={playMode || targetsMode ? () => clickSeat(p.id) : undefined}
        className={big ? 'w-full' : undefined}
      />
    )
  }

  const tableCentre = (
    <>
      <div className="flex flex-col items-center gap-1 text-xs text-rice-dim">
        <CardBack width={60} />
        <span>{view.deckCount} in deck</span>
      </div>
      <div className="flex min-h-[150px] min-w-[180px] flex-col items-center justify-center gap-2">
        {lp ? (
          <>
            <div key={lp.id} className="card-land flex gap-2">
              {lp.cards.map((id) => (
                <GameCard key={id} id={id} width={96} />
              ))}
            </div>
            <p className="max-w-xs text-center text-sm text-rice">
              {nameOf(lp.by)} played {CARD_INFO[lp.name].title}
              {lp.targets.length > 0 && <> on {lp.targets.map(nameOf).join(', ')}</>}
            </p>
          </>
        ) : (
          <p className="text-rice-dim">The first card has yet to be played.</p>
        )}
      </div>
    </>
  )

  const pickTarget = pr?.kind === 'pickCard' && mine ? view.players.find((p) => p.id === pr.data.target) : null

  return (
    <div className="table-felt flex min-h-dvh flex-col">
      {/* top bar */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-baseline gap-3">
          <span className="font-brush text-2xl text-gold">三国</span>
          <span className="text-sm text-rice-dim">{controls.title}</span>
          {view.phase === 'playing' && current && (
            <span className="text-sm text-rice-dim">
              Turn {view.turn}, {current.name}, {PHASE_LABEL[view.turnPhase]} phase
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {mesh && <MediaButtons mesh={mesh} />}
          <button type="button" onClick={() => setPanel((v) => !v)} className="rounded-md bg-jade-soft px-3 py-1.5 text-sm text-rice lg:hidden">
            {panel ? 'Close log' : 'Log & chat'}
          </button>
        </div>
      </header>
      {mesh?.mediaError && <p className="bg-cinnabar/90 px-3 py-1.5 text-sm text-rice">{mesh.mediaError}</p>}

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Phones: a simple grid of seats, then the table centre. */}
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:hidden">
            {others.map((p) => (
              <div key={p.id} className={cn('min-w-0', !p.alive && 'opacity-70')}>
                {seatFor(p, true)}
              </div>
            ))}
          </div>
          <div className="flex flex-1 items-center justify-center gap-6 px-3 py-4 md:hidden">{tableCentre}</div>

          {/* Larger screens: everyone sits around an oval table. You are at the bottom; the next
              player in turn order sits on your right and play continues around the table. */}
          <div className="relative mx-auto my-2 hidden w-full max-w-[1180px] md:block" style={{ height: 'clamp(540px, 70vh, 740px)' }}>
            <div
              aria-hidden
              className="absolute rounded-[50%] border-2 border-gold/45 bg-jade/70 shadow-[inset_0_0_80px_rgba(0,0,0,0.5)]"
              style={{ left: '17%', right: '17%', top: '27%', bottom: '6%' }}
            >
              <div className="absolute inset-3 rounded-[50%] border border-gold/20" />
            </div>
            <div className="absolute inset-x-[22%] top-[30%] bottom-[8%] flex items-center justify-center gap-6">{tableCentre}</div>
            {living.map((p, i) => {
              const pos = seatPosition(i, living.length)
              return (
                <div
                  key={p.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: 'clamp(128px, 12vw, 158px)' }}
                >
                  {seatFor(p, true, true)}
                </div>
              )
            })}
            {fallen.length > 0 && (
              <div className="absolute bottom-1 left-2 flex max-w-[45%] flex-wrap items-center gap-1.5 text-xs text-rice-dim">
                <span>Fallen:</span>
                {fallen.map((p) => (
                  <span key={p.id} className="rounded bg-ink/70 px-2 py-0.5 text-rice/80" title={p.role ? ROLE_LABEL[p.role] : undefined}>
                    {p.name}
                    {p.hero ? `, ${HEROES[p.hero].name}` : ''}
                    {p.role ? ` (${ROLE_LABEL[p.role]})` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* prompt / action bar */}
          <div className="sticky bottom-0 z-10 border-t border-gold/30 bg-jade-deep/95 backdrop-blur">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
              <div className="min-w-0 flex-1 text-[15px]">
                {view.phase === 'over' ? (
                  <span className="text-gold">The game is over.</span>
                ) : pr ? (
                  mine ? (
                    <span className="text-rice">
                      {pr.text} <Countdown deadline={pr.deadline} show={timers} />
                      {playMode && playError && targets.length > 0 && <span className="ml-2 text-cinnabar-bright">{playError}</span>}
                    </span>
                  ) : (
                    <span className="text-rice-dim">
                      {pr.waitingOn.length ? `Waiting for ${pr.waitingOn.map(nameOf).join(', ')}` : 'Waiting for anyone with a Negate'}{' '}
                      <Countdown deadline={pr.deadline} show={timers} />
                    </span>
                  )
                ) : (
                  <span className="text-rice-dim">Resolving…</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {playMode && (
                  <>
                    {activeSkills.map((s) => (
                      <Btn
                        key={s.id}
                        variant={skill === s.id ? 'gold' : 'quiet'}
                        disabled={!skillUsable(s.id) || busy}
                        onClick={() => {
                          if (s.id === 'sacrifice') return send({ action: 'skill', skill: s.id })
                          setSkill((k) => (k === s.id ? null : s.id))
                          setSel([])
                          setTargets([])
                        }}
                      >
                        {s.title}
                      </Btn>
                    ))}
                    {me?.hero === 'guanyu' && sel.length === 1 && card(sel[0]).name !== 'attack' && ['heart', 'diamond'].includes(card(sel[0]).suit) && !skill && (
                      <Btn variant={asAttack ? 'gold' : 'quiet'} onClick={() => setAsAttack((v) => !v)}>
                        Use as Attack
                      </Btn>
                    )}
                    {skill ? (
                      <Btn
                        disabled={busy || !sel.length || ((skill === 'benevolence' || skill === 'salve') && targets.length !== 1)}
                        onClick={() => send({ action: 'skill', skill, cards: sel, targets })}
                      >
                        {HEROES[me!.hero!].skills.find((s) => s.id === skill)?.title}
                      </Btn>
                    ) : (
                      <Btn
                        disabled={busy || !intent || !!playError}
                        onClick={() => intent && send({ action: 'card', cards: sel, as: intent.as, targets })}
                      >
                        {intent ? `Use ${CARD_INFO[intent.name].title}` : 'Use card'}
                      </Btn>
                    )}
                    <Btn variant="quiet" disabled={busy} onClick={() => send({ action: 'end' })}>
                      End turn
                    </Btn>
                  </>
                )}
                {respondMode && (
                  <>
                    {pr!.data.allowArmor && (
                      <Btn variant="gold" disabled={busy} onClick={() => send({ armor: true })}>
                        Judge with Eight Trigrams
                      </Btn>
                    )}
                    <Btn disabled={busy || !respondValid} onClick={() => send({ cards: sel })}>
                      Play {CARD_INFO[respondNeed!].title}
                    </Btn>
                    <Btn variant="quiet" disabled={busy} onClick={() => send({ pass: true })}>
                      {respondNeed === 'negate' ? 'Let it resolve' : respondNeed === 'peach' ? 'Don’t save' : 'Don’t play'}
                    </Btn>
                  </>
                )}
                {discardMode && (
                  <>
                    <Btn disabled={busy || sel.length !== pr!.data.count} onClick={() => send({ cards: sel })}>
                      Discard {sel.length}/{pr!.data.count}
                    </Btn>
                    {pr!.data.optional && (
                      <Btn variant="quiet" disabled={busy} onClick={() => send({ pass: true })}>
                        Skip
                      </Btn>
                    )}
                  </>
                )}
                {targetsMode && (
                  <>
                    <Btn disabled={busy || targets.length < pr!.data.min} onClick={() => send({ targets })}>
                      Raid {targets.length || ''}
                    </Btn>
                    {pr!.data.optional && (
                      <Btn variant="quiet" disabled={busy} onClick={() => send({ pass: true })}>
                        Draw normally
                      </Btn>
                    )}
                  </>
                )}
                {mine && pr?.kind === 'choose' &&
                  (pr.data.options as { id: string; label: string }[]).map((o) => (
                    <Btn key={o.id} disabled={busy} onClick={() => send({ choice: o.id })}>
                      {o.label}
                    </Btn>
                  ))}
              </div>
            </div>

            {/* my area: seat + hand */}
            {me && (
              <div className="flex items-end gap-3 px-3 pb-3">
                <div className="hidden w-[180px] shrink-0 sm:block">{seatFor(me, true)}</div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-3 text-sm text-rice-dim sm:hidden">
                    <span className="font-semibold text-rice">{me.hero ? HEROES[me.hero].name : me.name}</span>
                    <HpPips hp={me.hp} max={me.maxHp} />
                    {me.role && <span>{ROLE_LABEL[me.role]}</span>}
                  </div>
                  {me.hero && (
                    <p className="mb-1 hidden text-sm text-rice-dim md:block">
                      <span className="font-brush text-gold">{HERO_CJK[me.hero]}</span>{' '}
                      {HEROES[me.hero].skills.map((s) => (
                        <span key={s.id} className="mr-3" title={s.text}>
                          <span className="font-semibold text-rice">{s.title}:</span> {s.text}
                        </span>
                      ))}
                      <span className="text-rice-dim">
                        Attack range {attackRange(me)}
                        {weaponOf(me) ? ` (${CARD_INFO[weaponOf(me)!].title})` : ' (no weapon)'}: gold seats are in range. Steal
                        reaches distance 1.
                      </span>
                    </p>
                  )}
                  <div className="flex gap-2 overflow-x-auto pb-1 pt-4">
                    {(me.hand ?? []).map((id) => (
                      <GameCard
                        key={id}
                        id={id}
                        width={104}
                        selected={sel.includes(id)}
                        dimmed={cardDimmed(id)}
                        onClick={mine ? () => clickCard(id) : undefined}
                      />
                    ))}
                    {discardMode && pr!.data.allowEquip &&
                      (Object.values(me.equip).filter((v) => v != null) as number[])
                        .filter((id) => discardPool.includes(id))
                        .map((id) => (
                          <GameCard key={'e' + id} id={id} width={84} selected={sel.includes(id)} onClick={() => clickCard(id)} className="ring-1 ring-gold/50" />
                        ))}
                    {playMode && skill === 'balance' &&
                      (Object.values(me.equip).filter((v) => v != null) as number[]).map((id) => (
                        <GameCard
                          key={'b' + id}
                          id={id}
                          width={84}
                          selected={sel.includes(id)}
                          onClick={() => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
                          className="ring-1 ring-gold/50"
                        />
                      ))}
                    {(me.hand ?? []).length === 0 && <p className="py-8 text-rice-dim">No cards in hand.</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>

        <aside
          className={cn(
            'w-[300px] shrink-0 border-l border-border/60 bg-jade-deep/80',
            // Fixed height so a long log scrolls inside the panel instead of stretching the page.
            panel
              ? 'fixed inset-y-0 right-0 z-30 flex w-[min(320px,90vw)] flex-col shadow-2xl'
              : 'hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:self-start',
          )}
        >
          <SidePanel chat={controls.chat ?? null} log={view.log} onClose={() => setPanel(false)} />
        </aside>
      </div>

      {pickTarget && (
        <PickCardDialog
          target={pickTarget}
          text={pr!.text}
          allowHand={pr!.data.allowHand}
          allowEquip={pr!.data.allowEquip}
          allowJudge={pr!.data.allowJudge}
          onPick={(pick) => send({ pick })}
        />
      )}

      {view.phase === 'over' && view.winner && showOver && (
        <GameOver view={view} isHost={isHost} lobbyLabel={controls.lobbyLabel ?? 'Back to lobby'} onClose={() => setShowOver(false)} onLobby={controls.onLobby} />
      )}
    </div>
  )
}

/**
 * Seat centre (in % of the table box) for the i-th living opponent, counted in turn order
 * from the player after you. Like the web game: a column on your right (bottom to top),
 * a row across the top (right to left), then a column on your left (top to bottom).
 */
function seatPosition(i: number, n: number): { x: number; y: number } {
  const sides = n >= 6 ? 2 : n >= 3 ? 1 : 0
  const top = n - 2 * sides
  const sideYs = sides === 2 ? [67, 35] : [50]
  if (i < sides) return { x: 91, y: sideYs[i] }
  if (i < sides + top) {
    const k = i - sides
    const xs = top === 1 ? [50] : top === 2 ? [64, 36] : [72, 50, 28]
    return { x: xs[k], y: sides ? 14 : 16 }
  }
  const k = i - sides - top
  return { x: 9, y: [...sideYs].reverse()[k] }
}

function shortReason(err: string): string {
  if (/out of range/i.test(err)) return 'Out of attack range'
  if (/too far/i.test(err)) return 'Too far (needs distance 1)'
  if (/Empty Fort/.test(err)) return 'Empty Fort: no hand cards'
  if (/no cards/i.test(err)) return 'No cards to take'
  if (/already indulging/i.test(err)) return 'Already has Indulgence'
  if (/once per turn/i.test(err)) return 'Attack already used'
  return err.replace(/\.$/, '')
}

export function MediaButtons({ mesh }: { mesh: VideoMesh }) {
  if (!mesh.local) {
    return (
      <button type="button" onClick={mesh.enableMedia} className="rounded-md bg-cinnabar px-3 py-1.5 text-sm font-semibold text-rice hover:bg-cinnabar-bright">
        Turn on camera
      </button>
    )
  }
  return (
    <>
      <button
        type="button"
        onClick={mesh.toggleCam}
        aria-pressed={mesh.camOn}
        className={cn('rounded-md px-3 py-1.5 text-sm', mesh.camOn ? 'bg-jade-soft text-rice' : 'bg-cinnabar text-rice')}
      >
        {mesh.camOn ? 'Camera on' : 'Camera off'}
      </button>
      <button
        type="button"
        onClick={mesh.toggleMic}
        aria-pressed={mesh.micOn}
        className={cn('rounded-md px-3 py-1.5 text-sm', mesh.micOn ? 'bg-jade-soft text-rice' : 'bg-cinnabar text-rice')}
      >
        {mesh.micOn ? 'Mic on' : 'Muted'}
      </button>
    </>
  )
}

function PickCardDialog({
  target,
  text,
  allowHand,
  allowEquip,
  allowJudge,
  onPick,
}: {
  target: ViewPlayer
  text: string
  allowHand: boolean
  allowEquip: boolean
  allowJudge: boolean
  onPick: (pick: 'hand' | number) => void
}) {
  const equip = Object.values(target.equip).filter((v) => v != null) as number[]
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/70 p-4" role="dialog" aria-modal="true" aria-label={text}>
      <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-xl bg-jade p-5 gilt">
        <h2 className="mb-4 text-lg font-semibold text-rice">{text}</h2>
        {allowHand && target.handCount > 0 && (
          <section className="mb-4">
            <h3 className="mb-2 text-sm text-rice-dim">Hand ({target.handCount}). You take one at random.</h3>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: target.handCount }, (_, i) => (
                <button key={i} type="button" onClick={() => onPick('hand')} className="transition hover:-translate-y-1" aria-label="A random hand card">
                  <CardBack width={60} />
                </button>
              ))}
            </div>
          </section>
        )}
        {allowEquip && equip.length > 0 && (
          <section className="mb-4">
            <h3 className="mb-2 text-sm text-rice-dim">Equipment</h3>
            <div className="flex flex-wrap gap-2">
              {equip.map((id) => (
                <GameCard key={id} id={id} width={92} onClick={() => onPick(id)} />
              ))}
            </div>
          </section>
        )}
        {allowJudge && target.judge.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm text-rice-dim">Judgement area</h3>
            <div className="flex flex-wrap gap-2">
              {target.judge.map((id) => (
                <GameCard key={id} id={id} width={92} onClick={() => onPick(id)} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function GameOver({
  view,
  isHost,
  lobbyLabel,
  onClose,
  onLobby,
}: {
  view: GameView
  isHost: boolean
  lobbyLabel: string
  onClose: () => void
  onLobby: () => void
}) {
  const w = view.winner!
  const title = w.side === 'lord' ? 'The Lord holds the realm' : w.side === 'rebel' ? 'The Rebels have toppled the Lord' : 'The Spy stands alone'
  const iWon = !!view.me && w.players.includes(view.me)
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/75 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-lg rounded-xl bg-jade p-6 gilt">
        <p className="font-brush text-5xl text-gold">{iWon ? '胜' : view.me ? '败' : '终'}</p>
        <h2 className="mt-2 text-2xl font-semibold text-rice">{title}</h2>
        {view.me && <p className="text-rice-dim">{iWon ? 'You won.' : 'You lost this one.'}</p>}
        <ul className="my-4 divide-y divide-border/60">
          {view.players.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="text-rice">
                {p.name}
                {p.hero && <span className="text-rice-dim">, {HEROES[p.hero].name}</span>}
              </span>
              <span className={cn(w.players.includes(p.id) ? 'text-gold' : 'text-rice-dim')}>{p.role ? ROLE_LABEL[p.role] : ''}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {isHost ? <Btn onClick={onLobby}>{lobbyLabel}</Btn> : <p className="text-sm text-rice-dim">The host can start a new game.</p>}
          <Btn variant="quiet" onClick={onClose}>
            View the table
          </Btn>
        </div>
      </div>
    </div>
  )
}

function SidePanel({
  chat: chatCfg,
  log,
  onClose,
}: {
  chat: TableControls['chat'] | null
  log: GameView['log']
  onClose: () => void
}) {
  const [tab, setTab] = useState<'log' | 'chat'>('log')
  const chat = useQuery(api.rtc.chat, chatCfg ? { roomId: chatCfg.roomId } : 'skip')
  const sendChat = useMutation(api.rtc.sendChat)
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Scroll only the panel, never the page.
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log[log.length - 1]?.id, chat?.length, tab])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex border-b border-border/60" role="tablist">
        {(chatCfg ? (['log', 'chat'] as const) : (['log'] as const)).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn('flex-1 py-2 text-sm', tab === t ? 'border-b-2 border-gold text-rice' : 'text-rice-dim')}
          >
            {t === 'log' ? 'Battle log' : 'Chat'}
          </button>
        ))}
        <button type="button" onClick={onClose} className="px-3 text-rice-dim lg:hidden" aria-label="Close panel">
          ×
        </button>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 text-[13px] leading-snug">
        {tab === 'log'
          ? log.map((l) => (
              <p key={l.id} className={cn('py-0.5', l.text.startsWith('—') ? 'mt-2 font-semibold text-gold' : 'text-rice/90')}>
                {l.text}
              </p>
            ))
          : (chat ?? []).map((m) => (
              <p key={m.id} className="py-0.5 text-rice/90">
                <span className="font-semibold text-rice">{m.name}:</span> {m.text}
              </p>
            ))}
      </div>
      {tab === 'chat' && chatCfg?.canSend && (
        <form
          className="flex gap-2 border-t border-border/60 p-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!text.trim()) return
            sendChat({ roomId: chatCfg.roomId, token: chatCfg.token, text }).catch((err) => toast.error(errorText(err)))
            setText('')
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Say something"
            aria-label="Chat message"
            className="min-w-0 flex-1 rounded-md bg-jade px-2 py-1.5 text-sm text-rice placeholder:text-rice-dim"
          />
          <button type="submit" className="rounded-md bg-cinnabar px-3 text-sm text-rice">
            Send
          </button>
        </form>
      )}
    </div>
  )
}
