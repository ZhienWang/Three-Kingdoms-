// AI opponents for single-player mode.
//
// Bots play only on public information plus their own hand and role: they see
// the Lord (public), and they infer everyone else's allegiance from who
// targets whom with harmful cards. No peeking at other hands or hidden roles.

import { CARD_INFO, HEROES, card, rolesFor, slotFor } from './defs'
import type { CardName, HeroId } from './defs'
import { P, attackRange, distance, provides, validatePlay, weaponOf } from './engine'
import type { Answer, Game, Player } from './engine'

export interface BotMemory {
  /** > 0: behaves like a rebel (hostile to the Lord); < 0: behaves loyally. */
  suspicion: Record<string, number>
  seenPlay: number
  /** Actions taken in the current play phase, to cap runaway loops. */
  actions: number
  actionsTurn: number
}

export function newMemory(): BotMemory {
  return { suspicion: {}, seenPlay: 0, actions: 0, actionsTurn: -1 }
}

const HARMFUL: CardName[] = ['attack', 'duel', 'dismantle', 'steal', 'indulgence']
const HARMFUL_TRICKS: CardName[] = ['duel', 'dismantle', 'steal', 'barbarians', 'arrows', 'indulgence', 'lightning']

function lordOf(g: Game) {
  return g.players.find((p) => p.role === 'lord')!
}

function sus(g: Game, mem: BotMemory, pid: string) {
  if (pid === lordOf(g).id) return -10
  return mem.suspicion[pid] ?? 0
}

/** Update a bot's read of the table from the most recent public play. */
export function observe(g: Game, mem: BotMemory) {
  const lp = g.lastPlay
  if (!lp || lp.id === mem.seenPlay) return
  mem.seenPlay = lp.id
  if (!HARMFUL.includes(lp.name) || lp.by === lordOf(g).id) {
    // The Lord's own aggression says something about the target instead.
    if (lp.by === lordOf(g).id && HARMFUL.includes(lp.name)) {
      for (const t of lp.targets) mem.suspicion[t] = (mem.suspicion[t] ?? 0) + 0.5
    }
    return
  }
  for (const t of lp.targets) {
    const s = sus(g, mem, t)
    const delta = t === lordOf(g).id ? 2 : s < 0 ? 1 : s > 0 ? -1 : 0
    mem.suspicion[lp.by] = (mem.suspicion[lp.by] ?? 0) + delta
  }
}

type Stance = 'friend' | 'enemy' | 'unknown'

function stance(g: Game, mem: BotMemory, me: Player, other: Player): Stance {
  if (other.id === me.id) return 'friend'
  const lord = lordOf(g)
  const s = sus(g, mem, other.id)
  const aliveOthers = g.players.filter((p) => p.alive && p.id !== me.id)
  // Dead players' roles are public, so everyone can count the Rebels left.
  const rebelsLeft = rolesFor(g.players.length).filter((r) => r === 'rebel').length - g.players.filter((p) => !p.alive && p.role === 'rebel').length
  switch (me.role) {
    case 'lord':
    case 'loyalist':
      if (other.id === lord.id) return 'friend'
      if (rebelsLeft === 0) {
        // Only the Spy is left to find: go after the most suspicious survivor.
        const top = Math.max(...aliveOthers.filter((p) => p.id !== lord.id).map((p) => sus(g, mem, p.id)))
        return sus(g, mem, other.id) >= top ? 'enemy' : 'unknown'
      }
      return s >= 1 ? 'enemy' : s <= -1 ? 'friend' : 'unknown'
    case 'rebel':
      if (other.id === lord.id) return 'enemy'
      return s >= 1 ? 'friend' : s <= -1 ? 'enemy' : 'unknown'
    case 'spy':
      // Prop up the Lord while others remain, then turn on him at the end.
      if (aliveOthers.length === 1) return 'enemy'
      if (other.id === lord.id) return lord.hp <= 2 || rebelsLeft === 0 ? 'friend' : 'unknown'
      if (rebelsLeft === 0) return 'enemy'
      return s >= 1 ? 'enemy' : 'unknown'
  }
}

// ------------------------------------------------------------------ card value

function value(g: Game, me: Player, id: number): number {
  const c = card(id)
  const slot = slotFor(c.name)
  if (slot) return me.equip[slot] == null ? 5 : 2
  const base: Partial<Record<CardName, number>> = {
    peach: 10,
    negate: 8,
    drawtwo: 7,
    dodge: 6,
    duel: 6,
    steal: 6,
    dismantle: 6,
    indulgence: 6,
    attack: 5,
    barbarians: 5,
    arrows: 5,
    peachgarden: 4,
    lightning: 1,
  }
  let v = base[c.name] ?? 3
  // Extra copies are worth less.
  const copies = me.hand.filter((h) => card(h).name === c.name).length
  if (copies > 2 && (c.name === 'dodge' || c.name === 'attack')) v -= 2
  return v
}

function cheapest(g: Game, me: Player, pool: number[], n: number, exclude: number[] = []): number[] {
  return pool
    .filter((c) => !exclude.includes(c))
    .sort((a, b) => value(g, me, a) - value(g, me, b))
    .slice(0, n)
}

// ------------------------------------------------------------------ decisions

export function chooseHeroFor(g: Game, pid: string): HeroId {
  const p = P(g, pid)
  // Prefer sturdier heroes with simple skills; otherwise random.
  const rank: Partial<Record<HeroId, number>> = { zhaoyun: 3, guanyu: 3, zhangfei: 3, lubu: 3, machao: 2, xiahoudun: 2, caocao: 2, zhouyu: 2, sunquan: 2, liubei: 1 }
  return [...p.heroChoices].sort((a, b) => (rank[b] ?? 0) - (rank[a] ?? 0) + (Math.random() - 0.5))[0]
}

export function botDecide(g: Game, pid: string, mem: BotMemory): Answer {
  observe(g, mem)
  const pr = g.prompt!
  const me = P(g, pid)
  switch (pr.kind) {
    case 'play':
      return decidePlay(g, me, mem)
    case 'respond':
      return decideRespond(g, me, mem)
    case 'discard': {
      const pool = pr.data.allowEquip ? [...me.hand, ...(Object.values(me.equip).filter((v) => v != null) as number[])] : me.hand
      const exclude: number[] = (pr.data.exclude ?? []).filter((x: number | null) => x != null)
      if (pr.data.optional) {
        // Rock Cleaving Axe: force the hit on an enemy if we can spare the cards.
        const tgt = g.players.find((p) => pr.text.includes(p.name))
        const worth = tgt && stance(g, mem, me, tgt) === 'enemy' && me.hand.length >= 3
        if (!worth) return { pass: true }
      }
      return { cards: cheapest(g, me, pool, pr.data.count, exclude) }
    }
    case 'pickCard': {
      const tp = P(g, pr.data.target)
      const st = stance(g, mem, me, tp)
      if (st === 'friend' && pr.data.allowJudge) {
        const bad = tp.judge.find((c) => ['indulgence', 'lightning'].includes(card(c).name))
        if (bad != null) return { pick: bad }
      }
      if (pr.data.allowEquip) {
        for (const slot of ['armor', 'weapon', 'horsePlus', 'horseMinus'] as const) {
          const id = tp.equip[slot]
          if (id != null && (st !== 'friend' || tp.hand.length === 0)) return { pick: id }
        }
      }
      if (tp.hand.length && pr.data.allowHand) return { pick: 'hand' }
      const any = [...(Object.values(tp.equip).filter((v) => v != null) as number[]), ...(pr.data.allowJudge ? tp.judge : [])]
      return { pick: any[0] }
    }
    case 'choose':
      return { choice: me.hp <= 2 || me.hand.length >= 4 ? 'discard' : 'damage' }
    case 'targets': {
      const eligible = (pr.data.eligible as string[]).map((id) => P(g, id))
      const ranked = eligible
        .filter((p) => stance(g, mem, me, p) !== 'friend')
        .sort((a, b) => (stance(g, mem, me, a) === 'enemy' ? -1 : 0) - (stance(g, mem, me, b) === 'enemy' ? -1 : 0))
      if (ranked.length < 2) return { pass: true }
      return { targets: ranked.slice(0, 2).map((p) => p.id) }
    }
  }
}

function decideRespond(g: Game, me: Player, mem: BotMemory): Answer {
  const pr = g.prompt!
  const need: CardName = pr.data.need
  const own = g.players[g.current]?.id === me.id

  if (need === 'negate') {
    const about = pr.data.about as { card: CardName; target: string; src: string | null } | null
    if (!about) return { pass: true }
    const target = P(g, about.target)
    const st = stance(g, mem, me, target)
    const harmful = HARMFUL_TRICKS.includes(about.card)
    // Do we want this trick cancelled?
    const wantCancelled = harmful ? st === 'friend' : st === 'enemy'
    const isCancelled = !!pr.data.negated
    if (wantCancelled === isCancelled) return { pass: true }
    // Not worth a Negate for small stuff on unknowns.
    const c = me.hand.find((h) => card(h).name === 'negate')
    return c != null ? { cards: [c] } : { pass: true }
  }

  if (need === 'peach' && pr.data.dying) {
    const dying = P(g, pr.data.dying)
    const st = stance(g, mem, me, dying)
    if (st !== 'friend') return { pass: true }
  }

  if (pr.data.allowArmor) return { armor: true }

  const singles = me.hand
    .filter((c) => provides(me, [c], need, own))
    .sort((a, b) => {
      // Prefer the "real" card, then the cheapest conversion.
      const ra = card(a).name === need ? 0 : 1
      const rb = card(b).name === need ? 0 : 1
      return ra - rb || value(g, me, a) - value(g, me, b)
    })
  if (singles.length) return { cards: [singles[0]] }
  if (need === 'attack' && weaponOf(me) === 'serpentspear' && me.hand.length >= 2) {
    const two = cheapest(g, me, me.hand, 2)
    if (provides(me, two, 'attack', own)) return { cards: two }
  }
  return { pass: true }
}

function decidePlay(g: Game, me: Player, mem: BotMemory): Answer {
  if (mem.actionsTurn !== g.turn) {
    mem.actionsTurn = g.turn
    mem.actions = 0
  }
  if (++mem.actions > 25) return { action: 'end' }

  const others = g.players.filter((p) => p.alive && p.id !== me.id)
  const enemies = others.filter((p) => stance(g, mem, me, p) === 'enemy').sort((a, b) => a.hp - b.hp)
  const friends = others.filter((p) => stance(g, mem, me, p) === 'friend')
  const unknowns = others.filter((p) => stance(g, mem, me, p) === 'unknown')
  const of = (n: CardName) => me.hand.filter((c) => card(c).name === n)
  const tryPlay = (cards: number[], targets: string[] = [], as?: CardName): Answer | null => {
    const r = validatePlay(g, me, cards, as, targets)
    return 'error' in r ? null : { action: 'card', cards, as, targets }
  }

  // Heal up.
  if (me.hp < me.maxHp) for (const c of of('peach')) return tryPlay([c]) ?? { action: 'end' }

  // Equip anything that fills an empty slot or improves the weapon's reach.
  for (const c of me.hand) {
    const name = card(c).name
    const slot = slotFor(name)
    if (!slot) continue
    const cur = me.equip[slot]
    const better =
      cur == null ||
      (slot === 'weapon' && (CARD_INFO[name].range ?? 1) > attackRange(me) && weaponOf(me) !== 'crossbow')
    if (better) {
      const a = tryPlay([c])
      if (a) return a
    }
  }

  for (const c of of('drawtwo')) return tryPlay([c]) ?? { action: 'end' }

  // Hero skills.
  const hero = me.hero ? HEROES[me.hero] : null
  if (hero) {
    if (me.hero === 'huanggai' && me.hp >= 3) return { action: 'skill', skill: 'sacrifice' }
    if (me.hero === 'sunquan' && !me.flags.balance) {
      const junk = me.hand.filter((c) => value(g, me, c) <= 3)
      if (junk.length >= 2) return { action: 'skill', skill: 'balance', cards: junk }
    }
    if (me.hero === 'huatuo' && !me.flags.salve && me.hand.length) {
      const hurt = [me, ...friends].filter((p) => p.hp < p.maxHp).sort((a, b) => a.hp - b.hp)[0]
      if (hurt) return { action: 'skill', skill: 'salve', cards: cheapest(g, me, me.hand, 1), targets: [hurt.id] }
    }
    if (me.hero === 'liubei' && friends.length && me.hand.length > me.hp && !me.flags.healed) {
      const n = Math.min(me.hand.length - me.hp, Math.max(2 - me.flags.given, 1))
      return { action: 'skill', skill: 'benevolence', cards: cheapest(g, me, me.hand, n), targets: [friends[0].id] }
    }
  }

  // Harmful tricks against enemies.
  for (const c of of('indulgence')) {
    for (const e of enemies) {
      const a = tryPlay([c], [e.id])
      if (a) return a
    }
  }
  for (const c of of('dismantle')) {
    const friendInTrouble = friends.find((f) => f.judge.some((j) => ['indulgence', 'lightning'].includes(card(j).name)))
    for (const t of [...(friendInTrouble ? [friendInTrouble] : []), ...enemies]) {
      const a = tryPlay([c], [t.id])
      if (a) return a
    }
  }
  for (const c of of('steal')) {
    for (const t of [...enemies, ...unknowns.filter(() => me.role === 'lord')]) {
      const a = tryPlay([c], [t.id])
      if (a) return a
    }
  }
  const myAttacks = me.hand.filter((c) => provides(me, [c], 'attack', true)).length
  for (const c of of('duel')) {
    for (const e of enemies) {
      if (myAttacks >= 1 || e.hand.length <= 1) {
        const a = tryPlay([c], [e.id])
        if (a) return a
      }
    }
  }
  const aoeGood = enemies.length + unknowns.length / 2 > friends.length
  for (const c of [...of('barbarians'), ...of('arrows')]) {
    if (aoeGood) return tryPlay([c]) ?? { action: 'end' }
  }
  for (const c of of('peachgarden')) {
    const hurtFriends = [me, ...friends].filter((p) => p.hp < p.maxHp).length
    const hurtEnemies = enemies.filter((p) => p.hp < p.maxHp).length
    if (hurtFriends > hurtEnemies) return tryPlay([c]) ?? { action: 'end' }
  }
  for (const c of of('lightning')) {
    if (me.hp >= 3 && Math.random() < 0.4) {
      const a = tryPlay([c])
      if (a) return a
    }
  }

  // Attack: enemies first; the Lord probes unknowns when nobody has shown their hand.
  const attackTargets = [...enemies]
  if (!enemies.length && me.role === 'lord' && Math.random() < 0.6) attackTargets.push(...unknowns)
  if (attackTargets.length) {
    const attackCards = me.hand
      .filter((c) => provides(me, [c], 'attack', true))
      .sort((a, b) => (card(a).name === 'attack' ? 0 : 1) - (card(b).name === 'attack' ? 0 : 1) || value(g, me, a) - value(g, me, b))
    for (const c of attackCards) {
      const real = card(c).name === 'attack'
      for (const t of attackTargets) {
        if (distance(g.players, me.id, t.id) > attackRange(me)) continue
        const a = tryPlay([c], [t.id], real ? undefined : 'attack')
        if (a) return a
      }
    }
  }

  return { action: 'end' }
}

/** A safe fallback when a bot's chosen answer is rejected. */
export function fallbackAnswer(g: Game): Answer | null {
  const pr = g.prompt
  if (!pr) return null
  if (pr.kind === 'play') return { action: 'end' }
  if (pr.kind === 'respond' || pr.kind === 'targets' || (pr.kind === 'discard' && pr.data.optional)) return { pass: true }
  return null
}

export const BOT_NAMES = ['Wen', 'Ling', 'Bao', 'Jun', 'Mei', 'Tao', 'Rui']

