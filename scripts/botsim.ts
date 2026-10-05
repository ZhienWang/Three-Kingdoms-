// All-bot games using the single-player AI. Run: npx tsx scripts/botsim.ts [games]
import { DECK } from '../convex/game/defs'
import { answer, createGame, pickHero, timeout } from '../convex/game/engine'
import type { Game } from '../convex/game/engine'
import { botDecide, chooseHeroFor, fallbackAnswer, newMemory } from '../convex/game/bot'
import type { BotMemory } from '../convex/game/bot'

function total(g: Game) {
  let n = g.deck.length + g.discard.length
  for (const p of g.players) n += p.hand.length + p.judge.length + Object.values(p.equip).filter((v) => v != null).length
  return n
}

const games = Number(process.argv[2] || 300)
const results: Record<string, number> = {}
let turns = 0
let stalls = 0
let rejects = 0
let now = 1_000_000
for (let gi = 0; gi < games; gi++) {
  const n = 2 + (gi % 7)
  const g = createGame(Array.from({ length: n }, (_, i) => ({ id: 'b' + i, name: 'B' + i })), now)
  const mem: Record<string, BotMemory> = {}
  for (const p of g.players) mem[p.id] = newMemory()
  for (const p of g.players) pickHero(g, p.id, chooseHeroFor(g, p.id), now)
  let steps = 0
  while (g.phase === 'playing') {
    if (++steps > 30_000 || g.turn > 400) {
      stalls++
      if (process.env.DEBUG) console.log('STALL', g.turn, g.players.filter((p) => p.alive).map((p) => `${p.role}/${p.hero} hp${p.hp} hand${p.hand.length} ${JSON.stringify(mem[p.id].suspicion)}`).join(' | '), g.log.slice(-6).map((l) => l.text).join(' / '))
      break
    }
    const pr = g.prompt!
    const pid = pr.to.find((id) => !pr.passed.includes(id))!
    for (const m of Object.values(mem)) void m
    const a = botDecide(g, pid, mem[pid])
    let err = answer(g, pid, pr.id, a, now)
    if (err) {
      rejects++
      if (rejects < 8) console.log('reject', pr.kind, JSON.stringify(a), err)
      const fb = fallbackAnswer(g)
      err = fb ? answer(g, pid, pr.id, fb, now) : 'none'
      if (err) timeout(g, pr.id, pr.deadline + 1)
    }
    if (total(g) !== DECK.length) throw new Error('card count')
    now += 100
  }
  turns += g.turn
  const side = g.winner?.side ?? 'none'
  results[side] = (results[side] ?? 0) + 1
}
console.log('games', games, results, 'avg turns', (turns / games).toFixed(1), 'stalls', stalls, 'rejects', rejects)
