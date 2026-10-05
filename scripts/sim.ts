// Randomised self-play to shake out engine bugs. Run: npx tsx scripts/sim.ts [games]
import { DECK, HEROES, card } from '../convex/game/defs'
import type { CardName } from '../convex/game/defs'
import { answer, createGame, pickHero, provides, timeout, validatePlay } from '../convex/game/engine'
import type { Answer, Game } from '../convex/game/engine'

function total(g: Game) {
  let n = g.deck.length + g.discard.length
  for (const p of g.players) n += p.hand.length + p.judge.length + Object.values(p.equip).filter((v) => v != null).length
  return n
}

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)]
}

function botAnswer(g: Game): { pid: string; a: Answer } {
  const pr = g.prompt!
  const pid = pick(pr.to.filter((id) => !pr.passed.includes(id)))
  const p = g.players.find((x) => x.id === pid)!
  const own = g.players[g.current].id === pid
  switch (pr.kind) {
    case 'play': {
      if (Math.random() < 0.08) return { pid, a: { action: 'end' } }
      // try skills sometimes
      if (Math.random() < 0.15 && p.hero) {
        const sk = HEROES[p.hero].skills.find((s) => s.active)
        if (sk) {
          const others = g.players.filter((q) => q.alive && q.id !== pid)
          if (sk.id === 'benevolence' && p.hand.length && others.length) return { pid, a: { action: 'skill', skill: sk.id, cards: p.hand.slice(0, 2), targets: [pick(others).id] } }
          if (sk.id === 'balance' && p.hand.length) return { pid, a: { action: 'skill', skill: sk.id, cards: p.hand.slice(0, 2) } }
          if (sk.id === 'sacrifice' && p.hp > 1) return { pid, a: { action: 'skill', skill: sk.id } }
          if (sk.id === 'salve' && p.hand.length) {
            const w = g.players.filter((q) => q.alive && q.hp < q.maxHp)
            if (w.length) return { pid, a: { action: 'skill', skill: sk.id, cards: [p.hand[0]], targets: [pick(w).id] } }
          }
        }
      }
      for (let tries = 0; tries < 30; tries++) {
        const c = pick(p.hand)
        if (c == null) break
        const others = g.players.filter((q) => q.alive && q.id !== pid).map((q) => q.id)
        const as: CardName | undefined = Math.random() < 0.3 ? 'attack' : undefined
        const targets = Math.random() < 0.2 && others.length > 1 ? others.slice(0, 2) : others.length ? [pick(others)] : []
        const r = validatePlay(g, p, [c], as, targets)
        if (!('error' in r)) return { pid, a: { action: 'card', cards: [c], as, targets } }
      }
      return { pid, a: { action: 'end' } }
    }
    case 'respond': {
      if (pr.data.allowArmor && Math.random() < 0.5) return { pid, a: { armor: true } }
      if (Math.random() < 0.2) return { pid, a: { pass: true } }
      const c = p.hand.find((id) => provides(p, [id], pr.data.need, own))
      if (c != null) return { pid, a: { cards: [c] } }
      if (pr.data.need === 'attack' && p.hand.length >= 2 && provides(p, p.hand.slice(0, 2), 'attack', own)) return { pid, a: { cards: p.hand.slice(0, 2) } }
      return { pid, a: { pass: true } }
    }
    case 'discard': {
      if (pr.data.optional && Math.random() < 0.5) return { pid, a: { pass: true } }
      const pool = pr.data.allowEquip ? [...p.hand, ...(Object.values(p.equip).filter((v) => v != null) as number[])] : p.hand
      const ok = pool.filter((c) => !(pr.data.exclude ?? []).includes(c))
      return { pid, a: { cards: ok.slice(0, pr.data.count) } }
    }
    case 'pickCard': {
      const tp = g.players.find((x) => x.id === pr.data.target)!
      const opts: (number | 'hand')[] = []
      if (tp.hand.length) opts.push('hand')
      opts.push(...(Object.values(tp.equip).filter((v) => v != null) as number[]))
      if (pr.data.allowJudge) opts.push(...tp.judge)
      return { pid, a: { pick: pick(opts) } }
    }
    case 'choose':
      return { pid, a: { choice: pick(pr.data.options as { id: string }[]).id } }
    case 'targets':
      if (Math.random() < 0.3) return { pid, a: { pass: true } }
      return { pid, a: { targets: pr.data.eligible.slice(0, 1 + Math.floor(Math.random() * Math.min(2, pr.data.eligible.length))) } }
  }
}

const games = Number(process.argv[2] || 300)
let now = 1_000_000
const results: Record<string, number> = {}
let turns = 0
for (let gi = 0; gi < games; gi++) {
  const n = 2 + (gi % 7)
  const people = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }))
  const g = createGame(people, now)
  for (const p of g.players) {
    if (Math.random() < 0.9) {
      const err = pickHero(g, p.id, p.heroChoices[0], now)
      if (err) throw new Error(err)
    }
  }
  if (g.phase === 'heroSelect') {
    now += 60_000
    timeout(g, null, now)
  }
  let steps = 0
  while (g.phase === 'playing') {
    if (++steps > 20_000) {
      console.log('STALL', g.turn, g.prompt?.kind, g.prompt?.text)
      break
    }
    if (total(g) !== DECK.length) throw new Error(`card count ${total(g)} at step ${steps}`)
    if (!g.prompt) throw new Error('no prompt but playing; tasks=' + JSON.stringify(g.tasks))
    if (Math.random() < 0.02) {
      now += 61_000
      timeout(g, g.prompt.id, now)
      continue
    }
    const { pid, a } = botAnswer(g)
    const err = answer(g, pid, g.prompt.id, a, now)
    if (err) {
      // invalid bot choice: fall back to pass/end/default
      const pr = g.prompt!
      const fallback: Answer = pr.kind === 'play' ? { action: 'end' } : { pass: true }
      const e2 = answer(g, pid, pr.id, fallback, now)
      if (e2) {
        now += 61_000
        timeout(g, pr.id, now)
      }
    }
    for (const p of g.players) if (p.alive && p.hp > p.maxHp) throw new Error('hp overflow')
    now += 500
  }
  turns += g.turn
  const side = g.winner?.side ?? 'none'
  results[side] = (results[side] ?? 0) + 1
  if (total(g) !== DECK.length) throw new Error('final card count')
  void card
}
console.log('games', games, 'results', results, 'avg turns', (turns / games).toFixed(1))
