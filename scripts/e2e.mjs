// End-to-end smoke test against the deployed backend: three bot players create
// a room, join, start, pick heroes and play a number of decisions.
// Usage: node scripts/e2e.mjs [steps]
import fs from 'node:fs'
import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)
const client = new ConvexHttpClient(env.VITE_CONVEX_URL)
const api = anyApi
const steps = Number(process.argv[2] || 60)
const bots = ['e2e-a', 'e2e-b', 'e2e-c'].map((t) => ({ token: t + '-' + Date.now(), name: t.toUpperCase() }))

const code = await client.mutation(api.rooms.create, { token: bots[0].token, name: bots[0].name })
for (const b of bots.slice(1)) await client.mutation(api.rooms.join, { code, token: b.token, name: b.name })
let room = await client.query(api.rooms.get, { code, token: bots[0].token })
console.log('room', code, 'members', room.members.length)
await client.mutation(api.rooms.start, { roomId: room.roomId, token: bots[0].token })
for (const b of bots) {
  const r = await client.query(api.rooms.get, { code, token: b.token })
  const me = r.view.players.find((p) => p.id === r.me)
  await client.mutation(api.rooms.chooseHero, { roomId: r.roomId, token: b.token, hero: me.heroChoices[0] })
}
let acted = 0
for (let i = 0; i < steps; i++) {
  let did = false
  for (const b of bots) {
    const r = await client.query(api.rooms.get, { code, token: b.token })
    const v = r.view
    if (v.phase !== 'playing') {
      console.log('phase', v.phase, v.winner)
      process.exit(0)
    }
    const pr = v.prompt
    if (!pr || !pr.mine) continue
    const me = v.players.find((p) => p.id === r.me)
    let answer = { pass: true }
    if (pr.kind === 'play') {
      // try each hand card on each other player, else end
      answer = { action: 'end' }
      const others = v.players.filter((p) => p.alive && p.id !== me.id).map((p) => p.id)
      outer: for (const c of me.hand) {
        for (const t of [[], ...others.map((o) => [o])]) {
          const res = await client.mutation(api.rooms.act, { roomId: r.roomId, token: b.token, promptId: pr.id, answer: { action: 'card', cards: [c], targets: t } })
          if (!res.error) {
            answer = null
            break outer
          }
        }
      }
    } else if (pr.kind === 'discard') answer = pr.data.optional ? { pass: true } : { cards: me.hand.slice(0, pr.data.count) }
    else if (pr.kind === 'pickCard') answer = { pick: 'hand' }
    else if (pr.kind === 'choose') answer = { choice: pr.data.options[0].id }
    if (answer) {
      const res = await client.mutation(api.rooms.act, { roomId: r.roomId, token: b.token, promptId: pr.id, answer })
      if (res.error) console.log('error', pr.kind, res.error)
    }
    acted++
    did = true
    break
  }
  if (!did) await new Promise((r) => setTimeout(r, 300))
}
room = await client.query(api.rooms.get, { code, token: bots[0].token })
console.log('acted', acted, 'turn', room.view.turn, 'phase', room.view.phase)
console.log(room.view.log.slice(-12).map((l) => l.text).join('\n'))
