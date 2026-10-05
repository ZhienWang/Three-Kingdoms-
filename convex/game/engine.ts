// Server-authoritative rules engine. Pure functions over a serialisable Game
// object so it can be stored in Convex and unit-tested in isolation.
//
// Resolution model: `g.tasks` is a LIFO stack of small serialisable steps.
// `run()` pops and executes tasks until one of them needs a player decision,
// at which point it sets `g.prompt` and stops. Answering the prompt pushes the
// prompt's `resume` task (with the answer attached) and continues running.

import {
  CARD_INFO,
  DECK,
  HEROES,
  HERO_IDS,
  RANK_LABEL,
  SUIT_SYMBOL,
  card,
  cardColor,
  colorOf,
  rolesFor,
  slotFor,
} from './defs'
import type { CardName, EquipSlot, HeroId, Role } from './defs'

// ------------------------------------------------------------------ types

export interface Equip {
  weapon: number | null
  armor: number | null
  horsePlus: number | null
  horseMinus: number | null
}

export interface Flags {
  attacks: number
  balance: boolean
  salve: boolean
  given: number
  healed: boolean
}

export interface Player {
  id: string
  name: string
  seat: number
  role: Role
  hero: HeroId | null
  heroChoices: HeroId[]
  hp: number
  maxHp: number
  hand: number[]
  equip: Equip
  judge: number[]
  alive: boolean
  flags: Flags
}

export type PromptKind = 'play' | 'respond' | 'discard' | 'pickCard' | 'choose' | 'targets'

export interface Prompt {
  id: number
  kind: PromptKind
  to: string[]
  passed: string[]
  multi: boolean
  deadline: number
  text: string
  data: any
  resume: Task
}

export type Task = { t: string; [k: string]: any }

export interface LogEntry {
  id: number
  text: string
}

export interface LastPlay {
  id: number
  by: string
  cards: number[]
  name: CardName
  targets: string[]
}

export interface Winner {
  side: 'lord' | 'rebel' | 'spy'
  players: string[]
}

export interface Game {
  phase: 'heroSelect' | 'playing' | 'over'
  players: Player[]
  deck: number[]
  discard: number[]
  current: number
  turn: number
  turnPhase: 'start' | 'judge' | 'draw' | 'play' | 'discard' | 'end'
  tasks: Task[]
  vars: Record<string, any>
  prompt: Prompt | null
  promptSeq: number
  seq: number
  log: LogEntry[]
  logSeq: number
  lastPlay: LastPlay | null
  winner: Winner | null
  heroDeadline: number
  now: number
}

export type Answer = {
  pass?: boolean
  action?: 'card' | 'skill' | 'end'
  cards?: number[]
  as?: CardName
  targets?: string[]
  skill?: string
  armor?: boolean
  pick?: 'hand' | number
  choice?: string
}

export const TIMEOUTS = {
  play: 60_000,
  respond: 20_000,
  discard: 30_000,
  pickCard: 20_000,
  choose: 20_000,
  targets: 20_000,
  hero: 45_000,
}

// ------------------------------------------------------------------ helpers

function shuffle<T>(a: T[]): T[] {
  const r = a.slice()
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

export function P(g: Game, id: string): Player {
  const p = g.players.find((x) => x.id === id)
  if (!p) throw new Error('No such player ' + id)
  return p
}

function nm(g: Game, id: string | null | undefined): string {
  if (!id) return 'Nature'
  const p = g.players.find((x) => x.id === id)
  if (!p) return '?'
  return p.hero ? `${p.name} (${HEROES[p.hero].name})` : p.name
}

function cardLabel(id: number): string {
  const c = card(id)
  return `${CARD_INFO[c.name].title} ${SUIT_SYMBOL[c.suit]}${RANK_LABEL[c.rank]}`
}

function log(g: Game, text: string) {
  g.log.push({ id: ++g.logSeq, text })
  if (g.log.length > 120) g.log.splice(0, g.log.length - 120)
}

/** Push tasks so that the first argument runs first. */
function push(g: Game, ...tasks: Task[]) {
  for (let i = tasks.length - 1; i >= 0; i--) g.tasks.push(tasks[i])
}

function newKey(g: Game, init: any = {}): string {
  const k = 'k' + ++g.seq
  g.vars[k] = init
  return k
}

/** Players in seat order starting from index `start` (inclusive), alive only. */
export function orderFrom<T extends { alive: boolean }>(players: T[], start: number): T[] {
  const n = players.length
  const out: T[] = []
  for (let i = 0; i < n; i++) {
    const p = players[(start + i) % n]
    if (p.alive) out.push(p)
  }
  return out
}

type PublicPlayer = Pick<Player, 'id' | 'alive' | 'hero' | 'equip'>

export function weaponOf(p: { equip: Equip }): CardName | null {
  return p.equip.weapon == null ? null : card(p.equip.weapon).name
}
export function armorOf(p: { equip: Equip }): CardName | null {
  return p.equip.armor == null ? null : card(p.equip.armor).name
}

export function distance(players: PublicPlayer[], fromId: string, toId: string): number {
  if (fromId === toId) return 0
  const alive = players.filter((p) => p.alive)
  const a = alive.findIndex((p) => p.id === fromId)
  const b = alive.findIndex((p) => p.id === toId)
  if (a < 0 || b < 0) return 99
  const n = alive.length
  const cw = (b - a + n) % n
  let d = Math.min(cw, n - cw)
  const from = alive[a]
  const to = alive[b]
  if (to.equip.horsePlus != null) d += 1
  if (from.equip.horseMinus != null) d -= 1
  if (from.hero === 'machao') d -= 1
  return Math.max(1, d)
}

export function attackRange(p: { equip: Equip }): number {
  const w = weaponOf(p)
  return w ? (CARD_INFO[w].range ?? 1) : 1
}

export function hasAnyCard(p: { hand?: number[]; handCount?: number; equip: Equip; judge: number[] }, includeJudge = true) {
  const handN = p.hand ? p.hand.length : (p.handCount ?? 0)
  const eq = Object.values(p.equip).some((v) => v != null)
  return handN > 0 || eq || (includeJudge && p.judge.length > 0)
}

/** Can `cards` (from p's hand) be used as `need`? Handles hero/weapon conversions. */
export function provides(
  p: { hero: HeroId | null; hand: number[]; equip: Equip },
  cards: number[],
  need: CardName,
  isOwnTurn: boolean,
): boolean {
  if (!cards.length || cards.some((c) => !p.hand.includes(c))) return false
  if (new Set(cards).size !== cards.length) return false
  if (cards.length === 2) return need === 'attack' && weaponOf(p) === 'serpentspear'
  if (cards.length !== 1) return false
  const c = card(cards[0])
  if (c.name === need) return true
  if (p.hero === 'zhaoyun' && ((need === 'dodge' && c.name === 'attack') || (need === 'attack' && c.name === 'dodge')))
    return true
  if (p.hero === 'guanyu' && need === 'attack' && colorOf(c.suit) === 'red') return true
  if (p.hero === 'huatuo' && need === 'peach' && !isOwnTurn && colorOf(c.suit) === 'red') return true
  return false
}

export function canProvide(p: Player, need: CardName, isOwnTurn: boolean): boolean {
  if (p.hand.some((c) => provides(p, [c], need, isOwnTurn))) return true
  return need === 'attack' && weaponOf(p) === 'serpentspear' && p.hand.length >= 2
}

function isOwnTurn(g: Game, p: Player) {
  return g.players[g.current]?.id === p.id
}

function drawCards(g: Game, p: Player, n: number) {
  for (let i = 0; i < n; i++) {
    if (g.deck.length === 0) {
      g.deck = shuffle(g.discard)
      g.discard = []
      if (g.deck.length) log(g, 'The discard pile is reshuffled into the deck.')
    }
    const c = g.deck.pop()
    if (c == null) return
    p.hand.push(c)
  }
}

function toDiscard(g: Game, ids: number[]) {
  for (const id of ids) g.discard.push(id)
}

function removeFromHand(p: Player, ids: number[]) {
  for (const id of ids) {
    const i = p.hand.indexOf(id)
    if (i >= 0) p.hand.splice(i, 1)
  }
}

/** Removes a card from whichever zone of p it's in. Returns true if found. */
function takeFromPlayer(p: Player, id: number): boolean {
  const hi = p.hand.indexOf(id)
  if (hi >= 0) {
    p.hand.splice(hi, 1)
    return true
  }
  for (const k of Object.keys(p.equip) as EquipSlot[]) {
    if (p.equip[k] === id) {
      p.equip[k] = null
      return true
    }
  }
  const ji = p.judge.indexOf(id)
  if (ji >= 0) {
    p.judge.splice(ji, 1)
    return true
  }
  return false
}

function judge(g: Game, p: Player, reason: string): number {
  if (g.deck.length === 0) {
    g.deck = shuffle(g.discard)
    g.discard = []
  }
  const id = g.deck.pop()!
  g.discard.push(id)
  log(g, `Judgement for ${nm(g, p.id)} (${reason}): ${cardLabel(id)}.`)
  return id
}

function heal(g: Game, p: Player, n: number) {
  const before = p.hp
  p.hp = Math.min(p.maxHp, p.hp + n)
  if (p.hp > before) log(g, `${nm(g, p.id)} recovers ${p.hp - before} HP (${p.hp}/${p.maxHp}).`)
}

function ask(
  g: Game,
  opts: { kind: PromptKind; to: string[]; text: string; data?: any; resume: Task; multi?: boolean },
) {
  g.prompt = {
    id: ++g.promptSeq,
    kind: opts.kind,
    to: opts.to,
    passed: [],
    multi: !!opts.multi,
    deadline: g.now + TIMEOUTS[opts.kind],
    text: opts.text,
    data: opts.data ?? {},
    resume: opts.resume,
  }
}

function markPlay(g: Game, by: string, cards: number[], name: CardName, targets: string[] = []) {
  g.lastPlay = { id: ++g.seq, by, cards, name, targets }
}

/** A player plays response cards (e.g. Dodge) from hand to the discard pile. */
function playResponse(g: Game, p: Player, cards: number[], as: CardName) {
  removeFromHand(p, cards)
  toDiscard(g, cards)
  const real = cards.map(cardLabel).join(' + ')
  const conv = cards.length === 1 && card(cards[0]).name === as ? '' : ` as ${CARD_INFO[as].title}`
  log(g, `${nm(g, p.id)} plays ${real}${conv}.`)
  markPlay(g, p.id, cards, as)
}

// ------------------------------------------------------------------ setup

export function createGame(people: { id: string; name: string }[], now: number): Game {
  const roles = shuffle(rolesFor(people.length))
  // Lord sits at seat 0; everyone else keeps their join order after.
  const lordIdx = roles.indexOf('lord')
  const seated = people.map((p, i) => ({ ...p, role: roles[i] }))
  const ordered = [...seated.slice(lordIdx), ...seated.slice(0, lordIdx)]
  const lordOptions: HeroId[] = ['liubei', 'caocao', 'sunquan']
  const rest = shuffle(HERO_IDS.filter((h) => !lordOptions.includes(h)))
  // Deal hero options round-robin (up to 3 each) to non-lords, leftovers to the lord.
  const options: HeroId[][] = ordered.map((p) => (p.role === 'lord' ? [...lordOptions] : []))
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].role !== 'lord' && rest.length) options[i].push(rest.pop()!)
    }
  }
  const lordI = ordered.findIndex((p) => p.role === 'lord')
  while (rest.length && options[lordI].length < 5) options[lordI].push(rest.pop()!)
  const players: Player[] = ordered.map((p, seat) => {
    const choices = options[seat]
    return {
      id: p.id,
      name: p.name,
      seat,
      role: p.role,
      hero: null,
      heroChoices: choices,
      hp: 0,
      maxHp: 0,
      hand: [],
      equip: { weapon: null, armor: null, horsePlus: null, horseMinus: null },
      judge: [],
      alive: true,
      flags: freshFlags(),
    }
  })
  return {
    phase: 'heroSelect',
    players,
    deck: shuffle(DECK.map((c) => c.id)),
    discard: [],
    current: 0,
    turn: 0,
    turnPhase: 'start',
    tasks: [],
    vars: {},
    prompt: null,
    promptSeq: 0,
    seq: 0,
    log: [{ id: 1, text: 'Roles have been dealt. Choose your hero.' }],
    logSeq: 1,
    lastPlay: null,
    winner: null,
    heroDeadline: now + TIMEOUTS.hero,
    now,
  }
}

function freshFlags(): Flags {
  return { attacks: 0, balance: false, salve: false, given: 0, healed: false }
}

export function pickHero(g: Game, pid: string, hero: HeroId, now: number): string | null {
  g.now = now
  if (g.phase !== 'heroSelect') return 'Hero selection is over.'
  const p = P(g, pid)
  if (!p.heroChoices.includes(hero)) return 'That hero is not one of your choices.'
  if (p.hero) return 'You already picked.'
  p.hero = hero
  log(g, p.role === 'lord' ? `The Lord ${p.name} is ${HEROES[hero].name}.` : `${p.name} has chosen a hero.`)
  if (g.players.every((x) => x.hero)) startPlaying(g)
  return null
}

function startPlaying(g: Game) {
  for (const p of g.players) {
    const h = HEROES[p.hero!]
    p.maxHp = h.hp + (p.role === 'lord' && g.players.length >= 3 ? 1 : 0)
    p.hp = p.maxHp
    drawCards(g, p, 4)
  }
  g.phase = 'playing'
  g.current = 0
  log(g, 'Heroes revealed: ' + g.players.map((p) => `${p.name} → ${HEROES[p.hero!].name}`).join(', ') + '.')
  push(g, { t: 'turnStart', p: g.players[0].id })
  run(g)
}

// ------------------------------------------------------------------ running

function run(g: Game) {
  let guard = 0
  while (!g.prompt && g.tasks.length && g.phase === 'playing') {
    if (++guard > 10_000) throw new Error('engine loop guard')
    const task = g.tasks.pop()!
    const h = HANDLERS[task.t]
    if (!h) throw new Error('unknown task ' + task.t)
    h(g, task)
  }
}

function checkWinner(g: Game): Winner | null {
  const lord = g.players.find((p) => p.role === 'lord')!
  const alive = g.players.filter((p) => p.alive)
  if (!lord.alive) {
    if (alive.length === 1 && alive[0].role === 'spy') return { side: 'spy', players: [alive[0].id] }
    return { side: 'rebel', players: g.players.filter((p) => p.role === 'rebel').map((p) => p.id) }
  }
  if (!alive.some((p) => p.role === 'rebel' || p.role === 'spy'))
    return { side: 'lord', players: g.players.filter((p) => p.role === 'lord' || p.role === 'loyalist').map((p) => p.id) }
  return null
}

// ------------------------------------------------------------------ handlers

type Handler = (g: Game, t: Task) => void

const HANDLERS: Record<string, Handler> = {
  // ---------- turn structure
  turnStart(g, t) {
    const p = P(g, t.p)
    if (!p.alive) return push(g, { t: 'nextTurn' })
    g.turn++
    p.flags = freshFlags()
    g.turnPhase = 'start'
    log(g, `— Turn ${g.turn}: ${nm(g, p.id)} —`)
    push(
      g,
      { t: 'phaseJudge', p: p.id },
      { t: 'phaseDraw', p: p.id },
      { t: 'phasePlay', p: p.id },
      { t: 'phaseDiscard', p: p.id },
      { t: 'phaseEnd', p: p.id },
      { t: 'nextTurn' },
    )
  },

  nextTurn(g) {
    if (g.phase !== 'playing') return
    const n = g.players.length
    for (let i = 1; i <= n; i++) {
      const idx = (g.current + i) % n
      if (g.players[idx].alive) {
        g.current = idx
        delete g.vars.skipPlay
        return push(g, { t: 'turnStart', p: g.players[idx].id })
      }
    }
  },

  phaseJudge(g, t) {
    const p = P(g, t.p)
    if (!p.alive) return
    g.turnPhase = 'judge'
    const cards = p.judge.slice().reverse()
    const tasks: Task[] = []
    for (const id of cards) {
      const key = newKey(g, { negated: false })
      tasks.push(
        { t: 'negate', key, text: `Negate ${CARD_INFO[card(id).name].title} on ${nm(g, p.id)}?`, about: { card: card(id).name, target: p.id, src: null } },
        { t: 'delayed', p: p.id, id, key },
      )
    }
    push(g, ...tasks)
  },

  delayed(g, t) {
    const p = P(g, t.p)
    if (!p.alive || !p.judge.includes(t.id)) return
    const c = card(t.id)
    p.judge.splice(p.judge.indexOf(t.id), 1)
    const negated = g.vars[t.key]?.negated
    if (c.name === 'indulgence') {
      toDiscard(g, [t.id])
      if (negated) return log(g, `Indulgence on ${nm(g, p.id)} was negated.`)
      const j = card(judge(g, p, 'Indulgence'))
      if (j.suit !== 'heart') {
        g.vars.skipPlay = p.id
        log(g, `${nm(g, p.id)} is indulging and skips their play phase.`)
      } else log(g, `${nm(g, p.id)} shakes off Indulgence.`)
      return
    }
    if (c.name === 'lightning') {
      if (!negated) {
        const j = card(judge(g, p, 'Lightning'))
        if (j.suit === 'spade' && j.rank >= 2 && j.rank <= 9) {
          toDiscard(g, [t.id])
          log(g, `Lightning strikes ${nm(g, p.id)}!`)
          return push(g, { t: 'damage', src: null, target: p.id, amount: 3, cards: [], nature: 'thunder' })
        }
      }
      // pass to the next player without lightning
      const idx = g.players.indexOf(p)
      const next = orderFrom(g.players, idx + 1).find((q) => q.id !== p.id && !q.judge.some((id) => card(id).name === 'lightning'))
      if (next) {
        next.judge.push(t.id)
        log(g, `Lightning passes to ${nm(g, next.id)}.`)
      } else p.judge.push(t.id)
    }
  },

  phaseDraw(g, t) {
    const p = P(g, t.p)
    if (!p.alive) return
    g.turnPhase = 'draw'
    if (p.hero === 'zhangliao') {
      const eligible = g.players.filter((q) => q.alive && q.id !== p.id && q.hand.length > 0).map((q) => q.id)
      if (eligible.length) {
        return ask(g, {
          kind: 'targets',
          to: [p.id],
          text: 'Raid: take a hand card from up to two players instead of drawing? (Pass to draw normally.)',
          data: { min: 1, max: 2, eligible, optional: true, skill: 'raid' },
          resume: { t: 'raidAns', p: p.id },
        })
      }
    }
    const n = p.hero === 'zhouyu' ? 3 : 2
    drawCards(g, p, n)
    log(g, `${nm(g, p.id)} draws ${n} cards.`)
  },

  raidAns(g, t) {
    const p = P(g, t.p)
    const a: Answer = t.ans
    if (a.pass || !a.targets?.length) {
      drawCards(g, p, 2)
      return log(g, `${nm(g, p.id)} draws 2 cards.`)
    }
    for (const id of a.targets) {
      const q = P(g, id)
      if (!q.hand.length) continue
      const c = q.hand[Math.floor(Math.random() * q.hand.length)]
      removeFromHand(q, [c])
      p.hand.push(c)
    }
    log(g, `${nm(g, p.id)} raids ${a.targets.map((id) => nm(g, id)).join(' and ')}.`)
  },

  phasePlay(g, t) {
    const p = P(g, t.p)
    if (!p.alive || g.phase !== 'playing') return
    g.turnPhase = 'play'
    if (g.vars.skipPlay === p.id) return
    ask(g, { kind: 'play', to: [p.id], text: 'Your play phase: use cards or skills, then end the phase.', resume: { t: 'playAns', p: p.id } })
  },

  playAns(g, t) {
    const a: Answer = t.ans
    if (a.pass || a.action === 'end') return
    const next: Task = { t: 'phasePlay', p: t.p }
    if (a.action === 'skill') return push(g, { t: 'skill', by: t.p, skill: a.skill, cards: a.cards ?? [], targets: a.targets ?? [] }, next)
    push(g, { t: 'useCard', by: t.p, cards: a.cards, name: a.as, targets: a.targets ?? [] }, next)
  },

  phaseDiscard(g, t) {
    const p = P(g, t.p)
    if (!p.alive) return
    g.turnPhase = 'discard'
    const excess = p.hand.length - Math.max(0, p.hp)
    if (excess <= 0) return
    ask(g, {
      kind: 'discard',
      to: [p.id],
      text: `Discard ${excess} card${excess > 1 ? 's' : ''} (hand limit is your HP).`,
      data: { count: excess },
      resume: { t: 'discardAns', p: p.id },
    })
  },

  discardAns(g, t) {
    const p = P(g, t.p)
    const ids: number[] = t.ans.cards
    removeFromHand(p, ids)
    toDiscard(g, ids)
    log(g, `${nm(g, p.id)} discards ${ids.map(cardLabel).join(', ')}.`)
  },

  phaseEnd(g, t) {
    const p = P(g, t.p)
    if (!p.alive) return
    g.turnPhase = 'end'
    if (p.hero === 'diaochan') {
      drawCards(g, p, 1)
      log(g, `${nm(g, p.id)} draws 1 card (Closing Moon).`)
    }
  },

  // ---------- using cards
  useCard(g, t) {
    const p = P(g, t.by)
    if (!p.alive) return
    const name: CardName = t.name
    const cards: number[] = t.cards
    const targets: string[] = t.targets
    removeFromHand(p, cards)
    const tgt = targets.length ? ` → ${targets.map((id) => nm(g, id)).join(', ')}` : ''
    const conv = cards.length === 1 && card(cards[0]).name === name ? cardLabel(cards[0]) : `${CARD_INFO[name].title} (${cards.map(cardLabel).join(' + ')})`
    log(g, `${nm(g, p.id)} uses ${conv}${tgt}.`)
    markPlay(g, p.id, cards, name, targets)

    const slot = slotFor(name)
    if (slot) {
      const old = p.equip[slot]
      if (old != null) toDiscard(g, [old])
      p.equip[slot] = cards[0]
      return
    }
    if (name === 'indulgence') return void P(g, targets[0]).judge.push(cards[0])
    if (name === 'lightning') return void p.judge.push(cards[0])
    toDiscard(g, cards)

    switch (name) {
      case 'attack': {
        if (!t.free) p.flags.attacks++
        return push(g, ...targets.map((id) => ({ t: 'attack', src: p.id, target: id, cards })))
      }
      case 'peach':
        return heal(g, p, 1)
      case 'duel': {
        const key = newKey(g, { negated: false })
        return push(
          g,
          { t: 'negate', key, text: `Negate Duel on ${nm(g, targets[0])}?`, about: { card: name, target: targets[0], src: p.id } },
          { t: 'duelStart', a: p.id, b: targets[0], key, cards },
        )
      }
      case 'dismantle':
      case 'steal': {
        const key = newKey(g, { negated: false })
        return push(
          g,
          { t: 'negate', key, text: `Negate ${CARD_INFO[name].title} on ${nm(g, targets[0])}?`, about: { card: name, target: targets[0], src: p.id } },
          { t: 'pick', by: p.id, target: targets[0], mode: name, key },
        )
      }
      case 'barbarians':
      case 'arrows': {
        const idx = g.players.indexOf(p)
        const tasks: Task[] = []
        for (const q of orderFrom(g.players, idx + 1)) {
          if (q.id === p.id) continue
          const key = newKey(g, { negated: false })
          tasks.push(
            { t: 'negate', key, text: `Negate ${CARD_INFO[name].title} on ${nm(g, q.id)}?`, about: { card: name, target: q.id, src: p.id } },
            { t: 'aoe', src: p.id, target: q.id, need: name === 'barbarians' ? 'attack' : 'dodge', key, cards },
          )
        }
        return push(g, ...tasks)
      }
      case 'peachgarden': {
        const idx = g.players.indexOf(p)
        const tasks: Task[] = []
        for (const q of orderFrom(g.players, idx)) {
          if (q.hp >= q.maxHp) continue
          const key = newKey(g, { negated: false })
          tasks.push({ t: 'negate', key, text: `Negate Peach Garden on ${nm(g, q.id)}?`, about: { card: name, target: q.id, src: p.id } }, { t: 'heal', who: q.id, key })
        }
        return push(g, ...tasks)
      }
      case 'drawtwo': {
        const key = newKey(g, { negated: false })
        return push(g, { t: 'negate', key, text: `Negate Something from Nothing for ${nm(g, p.id)}?`, about: { card: name, target: p.id, src: p.id } }, { t: 'drawN', who: p.id, n: 2, key })
      }
    }
  },

  heal(g, t) {
    if (g.vars[t.key]?.negated) return
    const q = P(g, t.who)
    if (q.alive) heal(g, q, 1)
  },

  drawN(g, t) {
    if (t.key && g.vars[t.key]?.negated) return
    const q = P(g, t.who)
    if (!q.alive) return
    drawCards(g, q, t.n)
    log(g, `${nm(g, q.id)} draws ${t.n} cards.`)
  },

  // ---------- generic "play a card of type X" request
  need(g, t) {
    // {who, need, count, got, armor, armorTried, key, text}
    const p = P(g, t.who)
    if (!p.alive) return void (g.vars[t.key] = { ok: false })
    if (t.got >= t.count) return void (g.vars[t.key] = { ok: true })
    const armorOk = !!t.armor && t.armorTried !== t.got
    if (!armorOk && !canProvide(p, t.need, isOwnTurn(g, p))) return void (g.vars[t.key] = { ok: false })
    const left = t.count - t.got
    ask(g, {
      kind: 'respond',
      to: [p.id],
      text: t.text + (t.count > 1 ? ` (${left} more needed)` : ''),
      data: { need: t.need, allowArmor: armorOk },
      resume: { ...t, t: 'needAns' },
    })
  },

  needAns(g, t) {
    const a: Answer = t.ans
    const p = P(g, t.who)
    const next: Task = { ...t, t: 'need' }
    delete next.ans
    delete next.by
    if (a.pass) return void (g.vars[t.key] = { ok: false })
    if (a.armor) {
      next.armorTried = t.got
      const j = card(judge(g, p, 'Eight Trigrams'))
      if (colorOf(j.suit) === 'red') {
        next.got = t.got + 1
        log(g, `Eight Trigrams protects ${nm(g, p.id)}.`)
      }
      return push(g, next)
    }
    playResponse(g, p, a.cards!, t.need)
    next.got = t.got + 1
    push(g, next)
  },

  // ---------- attack
  attack(g, t) {
    const s = P(g, t.src)
    const tp = P(g, t.target)
    if (!tp.alive) return
    const color = cardColor(t.cards)
    const ignoreArmor = weaponOf(s) === 'bluesteel'
    const armor = ignoreArmor ? null : armorOf(tp)
    if (armor === 'renwang' && color === 'black') return log(g, `Renwang Shield blocks the black Attack on ${nm(g, tp.id)}.`)
    const key = newKey(g, { ok: false })
    if (s.hero === 'machao') {
      const j = card(judge(g, s, 'Iron Cavalry'))
      if (colorOf(j.suit) === 'red') {
        log(g, `Iron Cavalry: ${nm(g, tp.id)} cannot dodge!`)
        return push(g, { t: 'attackHit', src: s.id, target: tp.id, cards: t.cards, key })
      }
    }
    push(
      g,
      {
        t: 'need',
        who: tp.id,
        need: 'dodge',
        count: s.hero === 'lubu' ? 2 : 1,
        got: 0,
        armor: armor === 'eighttrigrams',
        armorTried: -1,
        key,
        text: `${nm(g, s.id)} attacks you. Play a Dodge?`,
      },
      { t: 'attackHit', src: s.id, target: tp.id, cards: t.cards, key },
    )
  },

  attackHit(g, t) {
    const s = P(g, t.src)
    const tp = P(g, t.target)
    if (!tp.alive) return
    const dodged = g.vars[t.key]?.ok
    if (!dodged) return push(g, ...hitTasks(s, tp, t.cards))
    log(g, `${nm(g, tp.id)} dodges.`)
    if (!s.alive) return
    const w = weaponOf(s)
    if (w === 'greendragon' && canProvide(s, 'attack', isOwnTurn(g, s))) {
      return ask(g, {
        kind: 'respond',
        to: [s.id],
        text: `Green Dragon Blade: attack ${nm(g, tp.id)} again?`,
        data: { need: 'attack' },
        resume: { t: 'greenDragonAns', src: s.id, target: tp.id },
      })
    }
    const discardable = s.hand.length + Object.entries(s.equip).filter(([k, v]) => k !== 'weapon' && v != null).length
    if (w === 'rockaxe' && discardable >= 2) {
      return ask(g, {
        kind: 'discard',
        to: [s.id],
        text: `Rock Cleaving Axe: discard 2 cards to force the hit on ${nm(g, tp.id)}?`,
        data: { count: 2, optional: true, allowEquip: true, exclude: [s.equip.weapon] },
        resume: { t: 'rockAxeAns', src: s.id, target: tp.id, cards: t.cards },
      })
    }
  },

  greenDragonAns(g, t) {
    const a: Answer = t.ans
    if (a.pass) return
    const s = P(g, t.src)
    playResponse(g, s, a.cards!, 'attack')
    push(g, { t: 'attack', src: s.id, target: t.target, cards: a.cards })
  },

  rockAxeAns(g, t) {
    const a: Answer = t.ans
    if (a.pass) return
    const s = P(g, t.src)
    for (const id of a.cards!) takeFromPlayer(s, id)
    toDiscard(g, a.cards!)
    log(g, `${nm(g, s.id)} swings the Rock Cleaving Axe!`)
    push(g, ...hitTasks(s, P(g, t.target), t.cards))
  },

  kirin(g, t) {
    const tp = P(g, t.target)
    if (!tp.alive) return
    const slot: EquipSlot | null = tp.equip.horsePlus != null ? 'horsePlus' : tp.equip.horseMinus != null ? 'horseMinus' : null
    if (!slot) return
    toDiscard(g, [tp.equip[slot]!])
    tp.equip[slot] = null
    log(g, `Kirin Bow shoots down ${nm(g, tp.id)}'s horse.`)
  },

  // ---------- damage & death
  damage(g, t) {
    const tp = P(g, t.target)
    if (!tp.alive) return
    tp.hp -= t.amount
    log(g, `${nm(g, tp.id)} takes ${t.amount} damage${t.src ? ` from ${nm(g, t.src)}` : ''} (${tp.hp}/${tp.maxHp}).`)
    push(g, { t: 'dying', target: tp.id, src: t.src, idx: 0 }, { ...t, t: 'afterDamage' })
  },

  dying(g, t) {
    const tp = P(g, t.target)
    if (!tp.alive || tp.hp > 0) return
    const order = orderFrom(g.players, g.current)
    for (let i = t.idx; i < order.length; i++) {
      const q = order[i]
      if (canProvide(q, 'peach', isOwnTurn(g, q))) {
        return ask(g, {
          kind: 'respond',
          to: [q.id],
          text: q.id === tp.id ? `You are dying (${tp.hp} HP)! Use a Peach to save yourself?` : `${nm(g, tp.id)} is dying (${tp.hp} HP). Use a Peach to save them?`,
          data: { need: 'peach', dying: tp.id },
          resume: { t: 'dyingAns', target: tp.id, src: t.src, idx: i, saver: q.id },
        })
      }
    }
    push(g, { t: 'death', target: tp.id, src: t.src })
  },

  dyingAns(g, t) {
    const a: Answer = t.ans
    if (a.pass) return push(g, { t: 'dying', target: t.target, src: t.src, idx: t.idx + 1 })
    const q = P(g, t.saver)
    playResponse(g, q, a.cards!, 'peach')
    heal(g, P(g, t.target), 1)
    push(g, { t: 'dying', target: t.target, src: t.src, idx: t.idx })
  },

  death(g, t) {
    const tp = P(g, t.target)
    if (!tp.alive) return
    tp.alive = false
    tp.hp = 0
    log(g, `${nm(g, tp.id)} has fallen. They were the ${tp.role.toUpperCase()}.`)
    const all = [...tp.hand, ...tp.judge, ...(Object.values(tp.equip).filter((v) => v != null) as number[])]
    tp.hand = []
    tp.judge = []
    tp.equip = { weapon: null, armor: null, horsePlus: null, horseMinus: null }
    toDiscard(g, all)
    const w = checkWinner(g)
    if (w) {
      g.winner = w
      g.phase = 'over'
      g.prompt = null
      g.tasks = []
      const label = w.side === 'lord' ? 'The Lord and Loyalists' : w.side === 'rebel' ? 'The Rebels' : 'The Spy'
      return log(g, `${label} win!`)
    }
    const src = t.src ? P(g, t.src) : null
    if (src && src.alive) {
      if (tp.role === 'rebel') {
        drawCards(g, src, 3)
        log(g, `${nm(g, src.id)} draws 3 cards for killing a Rebel.`)
      } else if (tp.role === 'loyalist' && src.role === 'lord') {
        const lost = [...src.hand, ...(Object.values(src.equip).filter((v) => v != null) as number[])]
        src.hand = []
        src.equip = { weapon: null, armor: null, horsePlus: null, horseMinus: null }
        toDiscard(g, lost)
        log(g, `The Lord killed a Loyalist and discards all their cards.`)
      }
    }
  },

  afterDamage(g, t) {
    const tp = P(g, t.target)
    if (!tp.alive) return
    const src = t.src ? P(g, t.src) : null
    if (tp.hero === 'caocao') {
      const got = (t.cards as number[]).filter((id) => g.discard.includes(id))
      if (got.length) {
        g.discard = g.discard.filter((id) => !got.includes(id))
        tp.hand.push(...got)
        log(g, `${nm(g, tp.id)} takes ${got.map(cardLabel).join(', ')} (Treachery).`)
      }
    }
    if (tp.hero === 'simayi' && src && src.alive && src.id !== tp.id && hasAnyCard(src, false)) {
      return ask(g, {
        kind: 'pickCard',
        to: [tp.id],
        text: `Feedback: take a card from ${nm(g, src.id)}.`,
        data: { target: src.id, allowHand: true, allowEquip: true, allowJudge: false },
        resume: { t: 'pickAns', by: tp.id, target: src.id, mode: 'feedback' },
      })
    }
    if (tp.hero === 'xiahoudun' && src && src.alive && src.id !== tp.id) {
      const j = card(judge(g, tp, 'Unyielding'))
      if (j.suit === 'heart') return
      if (src.hand.length >= 2) {
        return ask(g, {
          kind: 'choose',
          to: [src.id],
          text: `Unyielding: discard 2 hand cards, or take 1 damage from ${nm(g, tp.id)}?`,
          data: { options: [{ id: 'discard', label: 'Discard 2 cards' }, { id: 'damage', label: 'Take 1 damage' }] },
          resume: { t: 'unyieldAns', xhd: tp.id, src: src.id },
        })
      }
      push(g, { t: 'damage', src: tp.id, target: src.id, amount: 1, cards: [] })
    }
  },

  unyieldAns(g, t) {
    const choice = t.ans.pass ? 'damage' : t.ans.choice
    if (choice === 'discard') {
      return ask(g, {
        kind: 'discard',
        to: [t.src],
        text: 'Unyielding: choose 2 hand cards to discard.',
        data: { count: 2 },
        resume: { t: 'discardAns', p: t.src },
      })
    }
    push(g, { t: 'damage', src: t.xhd, target: t.src, amount: 1, cards: [] })
  },

  // ---------- tricks
  negate(g, t) {
    const holders = g.players.filter((q) => q.alive && q.hand.some((c) => card(c).name === 'negate')).map((q) => q.id)
    if (!holders.length) return
    ask(g, {
      kind: 'respond',
      multi: true,
      to: holders,
      text: t.text,
      // `about` lets players (and bots) see what is being negated and its current state.
      data: { need: 'negate', about: t.about ?? null, negated: !!g.vars[t.key]?.negated },
      resume: { t: 'negateAns', key: t.key, text: t.text, about: t.about },
    })
  },

  negateAns(g, t) {
    const a: Answer = t.ans
    if (a.pass) return
    const by = P(g, t.by)
    playResponse(g, by, a.cards!, 'negate')
    g.vars[t.key].negated = !g.vars[t.key].negated
    push(g, { t: 'negate', key: t.key, about: t.about, text: `${nm(g, by.id)} played Negate. Negate it back?` })
  },

  duelStart(g, t) {
    if (g.vars[t.key]?.negated) return log(g, 'The Duel was negated.')
    push(g, { t: 'duelStep', a: t.a, b: t.b, who: t.b, cards: t.cards })
  },

  duelStep(g, t) {
    const a = P(g, t.a)
    const b = P(g, t.b)
    if (!a.alive || !b.alive) return
    const other = t.who === t.a ? b : a
    const key = newKey(g, { ok: false })
    push(
      g,
      {
        t: 'need',
        who: t.who,
        need: 'attack',
        count: other.hero === 'lubu' ? 2 : 1,
        got: 0,
        key,
        text: `Duel with ${nm(g, other.id)}: play an Attack or take 1 damage.`,
      },
      { t: 'duelCheck', a: t.a, b: t.b, who: t.who, key, cards: t.cards },
    )
  },

  duelCheck(g, t) {
    const other = t.who === t.a ? t.b : t.a
    if (g.vars[t.key]?.ok) return push(g, { t: 'duelStep', a: t.a, b: t.b, who: other, cards: t.cards })
    push(g, { t: 'damage', src: other, target: t.who, amount: 1, cards: t.cards })
  },

  aoe(g, t) {
    if (g.vars[t.key]?.negated) return log(g, `${nm(g, t.target)} is protected by Negate.`)
    const tp = P(g, t.target)
    if (!tp.alive) return
    const key = newKey(g, { ok: false })
    const name = t.need === 'attack' ? 'Barbarian Invasion' : 'Arrow Volley'
    push(
      g,
      {
        t: 'need',
        who: tp.id,
        need: t.need,
        count: 1,
        got: 0,
        armor: t.need === 'dodge' && armorOf(tp) === 'eighttrigrams',
        armorTried: -1,
        key,
        text: `${name}! Play ${t.need === 'attack' ? 'an Attack' : 'a Dodge'} or take 1 damage.`,
      },
      { t: 'aoeCheck', src: t.src, target: tp.id, key, cards: t.cards },
    )
  },

  aoeCheck(g, t) {
    if (g.vars[t.key]?.ok) return
    push(g, { t: 'damage', src: t.src, target: t.target, amount: 1, cards: t.cards })
  },

  pick(g, t) {
    if (g.vars[t.key]?.negated) return log(g, `The ${CARD_INFO[t.mode as CardName].title} was negated.`)
    const p = P(g, t.by)
    const tp = P(g, t.target)
    if (!p.alive || !tp.alive || !hasAnyCard(tp)) return
    ask(g, {
      kind: 'pickCard',
      to: [p.id],
      text: t.mode === 'steal' ? `Steal: choose a card to take from ${nm(g, tp.id)}.` : `Dismantle: choose a card of ${nm(g, tp.id)} to discard.`,
      data: { target: tp.id, allowHand: true, allowEquip: true, allowJudge: true },
      resume: { t: 'pickAns', by: p.id, target: tp.id, mode: t.mode },
    })
  },

  pickAns(g, t) {
    const p = P(g, t.by)
    const tp = P(g, t.target)
    const pick = t.ans.pick
    let id: number
    if (pick === 'hand') {
      if (!tp.hand.length) return
      id = tp.hand[Math.floor(Math.random() * tp.hand.length)]
    } else id = pick
    if (!takeFromPlayer(tp, id)) return
    if (t.mode === 'dismantle') {
      toDiscard(g, [id])
      log(g, `${nm(g, p.id)} dismantles ${cardLabel(id)} from ${nm(g, tp.id)}.`)
    } else {
      p.hand.push(id)
      log(g, `${nm(g, p.id)} takes a card from ${nm(g, tp.id)}${pick === 'hand' ? '' : ` (${cardLabel(id)})`}.`)
    }
  },

  // ---------- active skills
  skill(g, t) {
    const p = P(g, t.by)
    if (!p.alive) return
    const cards: number[] = t.cards
    switch (t.skill) {
      case 'benevolence': {
        const q = P(g, t.targets[0])
        removeFromHand(p, cards)
        q.hand.push(...cards)
        p.flags.given += cards.length
        log(g, `${nm(g, p.id)} gives ${cards.length} card${cards.length > 1 ? 's' : ''} to ${nm(g, q.id)} (Benevolence).`)
        if (p.flags.given >= 2 && !p.flags.healed && p.hp < p.maxHp) {
          p.flags.healed = true
          heal(g, p, 1)
        }
        return
      }
      case 'balance': {
        for (const id of cards) takeFromPlayer(p, id)
        toDiscard(g, cards)
        drawCards(g, p, cards.length)
        p.flags.balance = true
        return log(g, `${nm(g, p.id)} discards ${cards.length} and draws ${cards.length} (Balance).`)
      }
      case 'sacrifice': {
        p.hp -= 1
        log(g, `${nm(g, p.id)} loses 1 HP (Self-Sacrifice) (${p.hp}/${p.maxHp}).`)
        return push(g, { t: 'dying', target: p.id, src: null, idx: 0 }, { t: 'drawN', who: p.id, n: 2 })
      }
      case 'salve': {
        removeFromHand(p, cards)
        toDiscard(g, cards)
        p.flags.salve = true
        const q = P(g, t.targets[0])
        log(g, `${nm(g, p.id)} applies Green Salve to ${nm(g, q.id)}.`)
        return heal(g, q, 1)
      }
    }
  },
}

function hitTasks(s: Player, tp: Player, cards: number[]): Task[] {
  const tasks: Task[] = [{ t: 'damage', src: s.id, target: tp.id, amount: 1, cards }]
  if (weaponOf(s) === 'kirinbow') tasks.push({ t: 'kirin', target: tp.id })
  return tasks
}

// ------------------------------------------------------------------ validation

export interface PlayIntent {
  name: CardName
  cards: number[]
  targets: string[]
}

/** Determine what card is being used in the play phase and validate targets. */
export function validatePlay(
  g: { players: Player[] } & Partial<Game>,
  p: Player,
  cards: number[],
  as: CardName | undefined,
  targets: string[],
): { error: string } | PlayIntent {
  if (!cards.length) return { error: 'Choose a card.' }
  if (cards.some((c) => !p.hand.includes(c))) return { error: 'That card is not in your hand.' }
  let name: CardName
  if (as && !(cards.length === 1 && card(cards[0]).name === as)) {
    if (as !== 'attack') return { error: 'That conversion is not allowed here.' }
    if (!provides(p, cards, 'attack', true)) return { error: 'Those cards cannot be used as an Attack.' }
    name = 'attack'
  } else {
    if (cards.length !== 1) return { error: 'Choose a single card.' }
    name = card(cards[0]).name
  }
  const others = (id: string) => id !== p.id
  const alive = (id: string) => g.players.some((q) => q.id === id && q.alive)
  const get = (id: string) => g.players.find((q) => q.id === id)!
  const uniq = new Set(targets).size === targets.length
  if (!uniq || !targets.every(alive)) return { error: 'Invalid target.' }
  const emptyFort = (id: string) => {
    const q = get(id)
    return q.hero === 'zhugeliang' && q.hand.length === 0
  }

  switch (name) {
    case 'attack': {
      if (p.flags.attacks >= 1 && weaponOf(p) !== 'crossbow' && p.hero !== 'zhangfei')
        return { error: 'You can only Attack once per turn.' }
      const max = weaponOf(p) === 'halberd' && cards.length === p.hand.length ? 3 : 1
      if (targets.length < 1 || targets.length > max) return { error: max > 1 ? 'Choose 1–3 targets.' : 'Choose one target.' }
      for (const id of targets) {
        if (!others(id)) return { error: 'You cannot attack yourself.' }
        if (distance(g.players, p.id, id) > attackRange(p)) return { error: `${get(id).name} is out of range.` }
        if (emptyFort(id)) return { error: 'Empty Fort: that player cannot be attacked now.' }
      }
      break
    }
    case 'dodge':
    case 'negate':
      return { error: `${CARD_INFO[name].title} can only be played in response.` }
    case 'peach':
      if (p.hp >= p.maxHp) return { error: 'You are already at full health.' }
      targets = []
      break
    case 'duel':
      if (targets.length !== 1 || !others(targets[0])) return { error: 'Choose another player to duel.' }
      if (emptyFort(targets[0])) return { error: 'Empty Fort: that player cannot be dueled now.' }
      break
    case 'dismantle':
    case 'steal': {
      if (targets.length !== 1 || !others(targets[0])) return { error: 'Choose another player.' }
      const q = get(targets[0])
      if (!hasAnyCard(q)) return { error: `${q.name} has no cards.` }
      if (name === 'steal' && distance(g.players, p.id, q.id) > 1) return { error: `${q.name} is too far away to steal from.` }
      break
    }
    case 'indulgence': {
      if (targets.length !== 1 || !others(targets[0])) return { error: 'Choose another player.' }
      if (get(targets[0]).judge.some((c) => card(c).name === 'indulgence')) return { error: 'They are already indulging.' }
      break
    }
    case 'lightning':
      if (p.judge.some((c) => card(c).name === 'lightning')) return { error: 'You already have Lightning.' }
      targets = []
      break
    default:
      targets = []
  }
  return { name, cards, targets }
}

function validateSkill(g: Game, p: Player, skill: string | undefined, cards: number[], targets: string[]): string | null {
  const hero = p.hero
  const inHand = cards.every((c) => p.hand.includes(c))
  const target = targets[0] ? g.players.find((q) => q.id === targets[0] && q.alive) : undefined
  switch (skill) {
    case 'benevolence':
      if (hero !== 'liubei') return 'Not your skill.'
      if (!cards.length || !inHand) return 'Choose hand cards to give.'
      if (!target || target.id === p.id) return 'Choose another player.'
      return null
    case 'balance': {
      if (hero !== 'sunquan') return 'Not your skill.'
      if (p.flags.balance) return 'Balance was already used this turn.'
      const owned = [...p.hand, ...(Object.values(p.equip).filter((v) => v != null) as number[])]
      if (!cards.length || !cards.every((c) => owned.includes(c))) return 'Choose cards to discard.'
      return null
    }
    case 'sacrifice':
      if (hero !== 'huanggai') return 'Not your skill.'
      return null
    case 'salve':
      if (hero !== 'huatuo') return 'Not your skill.'
      if (p.flags.salve) return 'Green Salve was already used this turn.'
      if (cards.length !== 1 || !inHand) return 'Choose one hand card to discard.'
      if (!target || target.hp >= target.maxHp) return 'Choose a wounded player.'
      return null
  }
  return 'Unknown skill.'
}

function validateAnswer(g: Game, pid: string, pr: Prompt, a: Answer): string | Answer {
  const p = P(g, pid)
  switch (pr.kind) {
    case 'play': {
      if (a.action === 'end') return { action: 'end' }
      if (a.action === 'skill') {
        const err = validateSkill(g, p, a.skill, a.cards ?? [], a.targets ?? [])
        return err ?? { action: 'skill', skill: a.skill, cards: a.cards ?? [], targets: a.targets ?? [] }
      }
      const res = validatePlay(g, p, a.cards ?? [], a.as, a.targets ?? [])
      if ('error' in res) return res.error
      return { action: 'card', cards: res.cards, as: res.name, targets: res.targets }
    }
    case 'respond': {
      if (a.armor) return pr.data.allowArmor ? { armor: true } : 'Your armor cannot help here.'
      const need: CardName = pr.data.need
      if (!provides(p, a.cards ?? [], need, isOwnTurn(g, p))) return `Choose a card that counts as ${CARD_INFO[need].title}.`
      return { cards: a.cards }
    }
    case 'discard': {
      const ids = a.cards ?? []
      const owned = pr.data.allowEquip ? [...p.hand, ...(Object.values(p.equip).filter((v) => v != null) as number[])] : p.hand
      const excl: number[] = pr.data.exclude ?? []
      if (ids.length !== pr.data.count || new Set(ids).size !== ids.length) return `Choose exactly ${pr.data.count} cards.`
      if (!ids.every((c) => owned.includes(c) && !excl.includes(c))) return 'You cannot discard those cards.'
      return { cards: ids }
    }
    case 'pickCard': {
      const tp = P(g, pr.data.target)
      if (a.pick === 'hand') return tp.hand.length && pr.data.allowHand ? { pick: 'hand' } : 'They have no hand cards.'
      const id = a.pick as number
      const inEquip = Object.values(tp.equip).includes(id)
      const inJudge = tp.judge.includes(id)
      if ((inEquip && pr.data.allowEquip) || (inJudge && pr.data.allowJudge)) return { pick: id }
      return 'Choose one of their cards.'
    }
    case 'choose':
      return pr.data.options.some((o: any) => o.id === a.choice) ? { choice: a.choice } : 'Choose an option.'
    case 'targets': {
      const ts = a.targets ?? []
      if (ts.length < pr.data.min || ts.length > pr.data.max) return `Choose ${pr.data.min}–${pr.data.max} players.`
      if (!ts.every((id) => pr.data.eligible.includes(id)) || new Set(ts).size !== ts.length) return 'Invalid selection.'
      return { targets: ts }
    }
  }
}

function passAllowed(pr: Prompt): boolean {
  if (pr.kind === 'discard') return !!pr.data.optional
  if (pr.kind === 'pickCard' || pr.kind === 'choose') return false
  if (pr.kind === 'targets') return !!pr.data.optional
  return true
}

function resume(g: Game, pr: Prompt, by: string, ans: Answer) {
  g.prompt = null
  push(g, { ...pr.resume, ans, by })
  run(g)
}

export function answer(g: Game, pid: string, promptId: number, a: Answer, now: number): string | null {
  g.now = now
  const pr = g.prompt
  if (g.phase !== 'playing' || !pr || pr.id !== promptId) return 'That decision has already been made.'
  if (!pr.to.includes(pid) || pr.passed.includes(pid)) return 'It is not your decision.'
  if (a.pass) {
    if (!passAllowed(pr)) return 'You must choose.'
    if (pr.multi) {
      pr.passed.push(pid)
      if (pr.passed.length < pr.to.length) return null
    }
    resume(g, pr, pid, { pass: true })
    return null
  }
  const v = validateAnswer(g, pid, pr, a)
  if (typeof v === 'string') return v
  resume(g, pr, pid, v)
  return null
}

function defaultAnswer(g: Game, pr: Prompt): { by: string; ans: Answer } {
  const by = pr.to.find((id) => !pr.passed.includes(id)) ?? pr.to[0]
  const p = P(g, by)
  switch (pr.kind) {
    case 'discard': {
      if (pr.data.optional) return { by, ans: { pass: true } }
      return { by, ans: { cards: p.hand.slice(-pr.data.count) } }
    }
    case 'pickCard': {
      const tp = P(g, pr.data.target)
      if (tp.hand.length) return { by, ans: { pick: 'hand' } }
      const any = [...(Object.values(tp.equip).filter((v) => v != null) as number[]), ...tp.judge]
      return { by, ans: { pick: any[0] } }
    }
    case 'choose':
      return { by, ans: { choice: pr.data.options[pr.data.options.length - 1].id } }
    default:
      return { by, ans: { pass: true } }
  }
}

/** Called by the scheduler when a prompt's deadline passes. */
export function timeout(g: Game, promptId: number | null, now: number): boolean {
  g.now = now
  if (g.phase === 'heroSelect') {
    if (now < g.heroDeadline - 500) return false
    for (const p of g.players) if (!p.hero) p.hero = p.heroChoices[0]
    startPlaying(g)
    return true
  }
  const pr = g.prompt
  if (!pr || pr.id !== promptId || now < pr.deadline - 500) return false
  const { by, ans } = defaultAnswer(g, pr)
  log(g, `${nm(g, by)} ran out of time.`)
  resume(g, pr, by, ans)
  return true
}

// ------------------------------------------------------------------ view

export type ViewPlayer = Omit<Player, 'hand' | 'role' | 'heroChoices'> & {
  handCount: number
  hand: number[] | null
  role: Role | null
  heroChoices: HeroId[] | null
}

export interface ViewPrompt {
  id: number
  kind: PromptKind
  text: string
  deadline: number
  mine: boolean
  waitingOn: string[]
  data: any
}

export interface GameView {
  phase: Game['phase']
  players: ViewPlayer[]
  me: string | null
  current: number
  turn: number
  turnPhase: Game['turnPhase']
  deckCount: number
  discardTop: number[]
  prompt: ViewPrompt | null
  log: LogEntry[]
  lastPlay: LastPlay | null
  winner: Winner | null
  heroDeadline: number
}

export function viewFor(g: Game, pid: string | null): GameView {
  const over = g.phase === 'over'
  const selecting = g.phase === 'heroSelect'
  const pr = g.prompt
  return {
    phase: g.phase,
    me: pid,
    players: g.players.map((p) => {
      const mine = p.id === pid
      const { hand, role, heroChoices, ...rest } = p
      return {
        ...rest,
        hero: selecting && !mine && p.role !== 'lord' ? null : p.hero,
        handCount: hand.length,
        hand: mine ? hand : null,
        role: mine || role === 'lord' || !p.alive || over ? role : null,
        heroChoices: mine && selecting ? heroChoices : null,
      }
    }),
    current: g.current,
    turn: g.turn,
    turnPhase: g.turnPhase,
    deckCount: g.deck.length,
    discardTop: g.discard.slice(-3),
    prompt: pr
      ? {
          id: pr.id,
          kind: pr.kind,
          text: pr.text,
          deadline: pr.deadline,
          mine: !!pid && pr.to.includes(pid) && !pr.passed.includes(pid),
          // Hide who holds a Negate: everyone just sees a generic wait.
          waitingOn: pr.multi ? [] : pr.to,
          data: pr.data,
        }
      : null,
    log: g.log.slice(-60),
    lastPlay: g.lastPlay,
    winner: g.winner,
    heroDeadline: g.heroDeadline,
  }
}

/** Current deadline the server should schedule a timeout for. */
export function nextDeadline(g: Game): { promptId: number | null; at: number } | null {
  if (g.phase === 'heroSelect') return { promptId: null, at: g.heroDeadline }
  if (g.phase === 'playing' && g.prompt) return { promptId: g.prompt.id, at: g.prompt.deadline }
  return null
}
