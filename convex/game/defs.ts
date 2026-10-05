// Static game definitions: cards, deck, heroes. Shared by server and client.

export type Suit = 'spade' | 'heart' | 'club' | 'diamond'
export type Color = 'red' | 'black' | 'none'
export type Kingdom = 'shu' | 'wei' | 'wu' | 'qun'
export type Role = 'lord' | 'loyalist' | 'rebel' | 'spy'

export type CardName =
  | 'attack' | 'dodge' | 'peach'
  | 'duel' | 'dismantle' | 'steal' | 'barbarians' | 'arrows' | 'peachgarden' | 'drawtwo' | 'negate'
  | 'indulgence' | 'lightning'
  | 'crossbow' | 'bluesteel' | 'greendragon' | 'serpentspear' | 'rockaxe' | 'halberd' | 'kirinbow'
  | 'eighttrigrams' | 'renwang'
  | 'horseplus' | 'horseminus'

export type CardType = 'basic' | 'trick' | 'delayed' | 'weapon' | 'armor' | 'horsePlus' | 'horseMinus'
export type EquipSlot = 'weapon' | 'armor' | 'horsePlus' | 'horseMinus'

export interface CardInfo {
  name: CardName
  title: string
  type: CardType
  text: string
  range?: number
}

export const CARD_INFO: Record<CardName, CardInfo> = {
  attack: { name: 'attack', title: 'Attack', type: 'basic', text: 'Deal 1 damage to a player within your attack range unless they play a Dodge. Once per turn.' },
  dodge: { name: 'dodge', title: 'Dodge', type: 'basic', text: 'Play in response to an Attack to cancel it.' },
  peach: { name: 'peach', title: 'Peach', type: 'basic', text: 'Recover 1 HP during your turn, or save a dying player.' },
  duel: { name: 'duel', title: 'Duel', type: 'trick', text: 'You and a target take turns playing Attack. The first who cannot takes 1 damage.' },
  dismantle: { name: 'dismantle', title: 'Dismantle', type: 'trick', text: 'Discard one card from any player’s hand, equipment or judgement area.' },
  steal: { name: 'steal', title: 'Steal', type: 'trick', text: 'Take one card from a player at distance 1.' },
  barbarians: { name: 'barbarians', title: 'Barbarian Invasion', type: 'trick', text: 'Every other player must play an Attack or take 1 damage.' },
  arrows: { name: 'arrows', title: 'Arrow Volley', type: 'trick', text: 'Every other player must play a Dodge or take 1 damage.' },
  peachgarden: { name: 'peachgarden', title: 'Peach Garden', type: 'trick', text: 'Every player recovers 1 HP.' },
  drawtwo: { name: 'drawtwo', title: 'Something from Nothing', type: 'trick', text: 'Draw 2 cards.' },
  negate: { name: 'negate', title: 'Negate', type: 'trick', text: 'Cancel the effect of a trick on one target. Can negate a Negate.' },
  indulgence: { name: 'indulgence', title: 'Indulgence', type: 'delayed', text: 'Place on another player. In their judgement phase, unless the judgement is a heart, they skip their play phase.' },
  lightning: { name: 'lightning', title: 'Lightning', type: 'delayed', text: 'Place on yourself. In judgement, a spade 2–9 deals 3 damage; otherwise it passes to the next player.' },
  crossbow: { name: 'crossbow', title: 'Zhuge Crossbow', type: 'weapon', range: 1, text: 'Range 1. You may use any number of Attacks per turn.' },
  bluesteel: { name: 'bluesteel', title: 'Blue Steel Sword', type: 'weapon', range: 2, text: 'Range 2. Your Attacks ignore armor.' },
  greendragon: { name: 'greendragon', title: 'Green Dragon Blade', type: 'weapon', range: 3, text: 'Range 3. When your Attack is dodged, you may Attack the same target again.' },
  serpentspear: { name: 'serpentspear', title: 'Serpent Spear', type: 'weapon', range: 3, text: 'Range 3. You may use any two hand cards as an Attack.' },
  rockaxe: { name: 'rockaxe', title: 'Rock Cleaving Axe', type: 'weapon', range: 3, text: 'Range 3. When your Attack is dodged, you may discard two cards to make it hit.' },
  halberd: { name: 'halberd', title: 'Heaven Halberd', type: 'weapon', range: 4, text: 'Range 4. If your Attack is your last hand card, it may target up to 3 players.' },
  kirinbow: { name: 'kirinbow', title: 'Kirin Bow', type: 'weapon', range: 5, text: 'Range 5. When your Attack deals damage, discard one of the target’s horses.' },
  eighttrigrams: { name: 'eighttrigrams', title: 'Eight Trigrams', type: 'armor', text: 'When you need a Dodge, you may judge: if red, it counts as a Dodge.' },
  renwang: { name: 'renwang', title: 'Renwang Shield', type: 'armor', text: 'Black Attacks have no effect on you.' },
  horseplus: { name: 'horseplus', title: '+1 Horse', type: 'horsePlus', text: 'Other players are 1 further away from you.' },
  horseminus: { name: 'horseminus', title: '−1 Horse', type: 'horseMinus', text: 'You are 1 closer to other players.' },
}

export function slotFor(name: CardName): EquipSlot | null {
  const t = CARD_INFO[name].type
  return t === 'weapon' || t === 'armor' || t === 'horsePlus' || t === 'horseMinus' ? t : null
}

export interface Card {
  id: number
  name: CardName
  suit: Suit
  rank: number
}

// Deck composition: [name, suits]
const DECK_SPEC: [CardName, Suit[]][] = [
  ['attack', [...rep('spade', 7), ...rep('club', 14), ...rep('heart', 3), ...rep('diamond', 6)]],
  ['dodge', [...rep('heart', 3), ...rep('diamond', 12)]],
  ['peach', [...rep('heart', 7), 'diamond']],
  ['duel', ['spade', 'club', 'diamond']],
  ['dismantle', ['spade', 'spade', 'spade', 'club', 'club', 'heart']],
  ['steal', ['spade', 'spade', 'spade', 'diamond', 'diamond']],
  ['barbarians', ['spade', 'spade', 'club']],
  ['arrows', ['heart']],
  ['peachgarden', ['heart']],
  ['drawtwo', ['heart', 'heart', 'heart', 'heart']],
  ['negate', ['spade', 'club', 'club', 'diamond']],
  ['indulgence', ['spade', 'club', 'heart']],
  ['lightning', ['spade']],
  ['crossbow', ['club', 'diamond']],
  ['bluesteel', ['spade']],
  ['greendragon', ['spade']],
  ['serpentspear', ['spade']],
  ['rockaxe', ['diamond']],
  ['halberd', ['diamond']],
  ['kirinbow', ['heart']],
  ['eighttrigrams', ['spade', 'club']],
  ['renwang', ['club']],
  ['horseplus', ['spade', 'club', 'heart']],
  ['horseminus', ['heart', 'spade', 'diamond']],
]

function rep(v: Suit, n: number): Suit[] {
  return Array.from({ length: n }, () => v)
}

export const DECK: Card[] = (() => {
  const out: Card[] = []
  let i = 0
  for (const [name, suits] of DECK_SPEC) {
    for (const suit of suits) {
      let rank = ((i * 7 + 3) % 13) + 1
      if (name === 'lightning') rank = 1
      out.push({ id: out.length, name, suit, rank })
      i++
    }
  }
  return out
})()

export function card(id: number): Card {
  return DECK[id]
}

export function colorOf(suit: Suit): Color {
  return suit === 'heart' || suit === 'diamond' ? 'red' : 'black'
}

export function cardColor(ids: number[]): Color {
  if (ids.length === 0) return 'none'
  const cs = new Set(ids.map((id) => colorOf(DECK[id].suit)))
  return cs.size === 1 ? [...cs][0] : 'none'
}

export const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
export const SUIT_SYMBOL: Record<Suit, string> = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' }

// ---------------------------------------------------------------- heroes

export type HeroId =
  | 'liubei' | 'guanyu' | 'zhangfei' | 'zhugeliang' | 'zhaoyun' | 'machao'
  | 'caocao' | 'simayi' | 'xiahoudun' | 'zhangliao'
  | 'sunquan' | 'zhouyu' | 'huanggai'
  | 'lubu' | 'diaochan' | 'huatuo'

export interface SkillInfo {
  id: string
  title: string
  text: string
  active?: boolean // usable from the play phase
}

export interface HeroInfo {
  id: HeroId
  name: string
  kingdom: Kingdom
  hp: number
  female?: boolean
  lordCandidate?: boolean
  skills: SkillInfo[]
}

export const HEROES: Record<HeroId, HeroInfo> = {
  liubei: {
    id: 'liubei', name: 'Liu Bei', kingdom: 'shu', hp: 4, lordCandidate: true,
    skills: [{ id: 'benevolence', title: 'Benevolence', active: true, text: 'In your play phase, give any number of hand cards to another player. When you have given 2 or more cards in a turn, recover 1 HP (once per turn).' }],
  },
  guanyu: {
    id: 'guanyu', name: 'Guan Yu', kingdom: 'shu', hp: 4,
    skills: [{ id: 'warsaint', title: 'Warrior Saint', text: 'You may use any red hand card as an Attack.' }],
  },
  zhangfei: {
    id: 'zhangfei', name: 'Zhang Fei', kingdom: 'shu', hp: 4,
    skills: [{ id: 'roar', title: 'Roar', text: 'You may use any number of Attacks in your turn.' }],
  },
  zhugeliang: {
    id: 'zhugeliang', name: 'Zhuge Liang', kingdom: 'shu', hp: 3,
    skills: [{ id: 'emptyfort', title: 'Empty Fort', text: 'While you have no hand cards, you cannot be targeted by Attack or Duel.' }],
  },
  zhaoyun: {
    id: 'zhaoyun', name: 'Zhao Yun', kingdom: 'shu', hp: 4,
    skills: [{ id: 'dragoncourage', title: 'Dragon Courage', text: 'You may use Attack as Dodge, and Dodge as Attack.' }],
  },
  machao: {
    id: 'machao', name: 'Ma Chao', kingdom: 'shu', hp: 4,
    skills: [
      { id: 'horsemanship', title: 'Horsemanship', text: 'You are always 1 closer to other players.' },
      { id: 'ironcavalry', title: 'Iron Cavalry', text: 'When your Attack targets a player, judge: if red, it cannot be dodged.' },
    ],
  },
  caocao: {
    id: 'caocao', name: 'Cao Cao', kingdom: 'wei', hp: 4, lordCandidate: true,
    skills: [{ id: 'treachery', title: 'Treachery', text: 'When you take damage, take the card that caused it into your hand.' }],
  },
  simayi: {
    id: 'simayi', name: 'Sima Yi', kingdom: 'wei', hp: 3,
    skills: [{ id: 'feedback', title: 'Feedback', text: 'When you take damage, take one card from the source.' }],
  },
  xiahoudun: {
    id: 'xiahoudun', name: 'Xiahou Dun', kingdom: 'wei', hp: 4,
    skills: [{ id: 'unyielding', title: 'Unyielding', text: 'When you take damage, judge: unless it is a heart, the source discards 2 hand cards or takes 1 damage.' }],
  },
  zhangliao: {
    id: 'zhangliao', name: 'Zhang Liao', kingdom: 'wei', hp: 4,
    skills: [{ id: 'raid', title: 'Raid', text: 'In your draw phase, instead of drawing, you may take one hand card from each of up to two other players.' }],
  },
  sunquan: {
    id: 'sunquan', name: 'Sun Quan', kingdom: 'wu', hp: 4, lordCandidate: true,
    skills: [{ id: 'balance', title: 'Balance', active: true, text: 'Once per play phase, discard any number of cards and draw that many.' }],
  },
  zhouyu: {
    id: 'zhouyu', name: 'Zhou Yu', kingdom: 'wu', hp: 3,
    skills: [{ id: 'handsome', title: 'Heroic Bearing', text: 'Draw 3 cards in your draw phase.' }],
  },
  huanggai: {
    id: 'huanggai', name: 'Huang Gai', kingdom: 'wu', hp: 4,
    skills: [{ id: 'sacrifice', title: 'Self-Sacrifice', active: true, text: 'In your play phase, any number of times: lose 1 HP, then draw 2 cards.' }],
  },
  lubu: {
    id: 'lubu', name: 'Lü Bu', kingdom: 'qun', hp: 4,
    skills: [{ id: 'unmatched', title: 'Unmatched', text: 'Your Attacks need two Dodges to cancel. In a Duel, your opponent must play two Attacks each time.' }],
  },
  diaochan: {
    id: 'diaochan', name: 'Diaochan', kingdom: 'qun', hp: 3, female: true,
    skills: [{ id: 'closingmoon', title: 'Closing Moon', text: 'At the end of your turn, draw 1 card.' }],
  },
  huatuo: {
    id: 'huatuo', name: 'Hua Tuo', kingdom: 'qun', hp: 3,
    skills: [
      { id: 'firstaid', title: 'First Aid', text: 'Outside your turn, you may use any red hand card as a Peach.' },
      { id: 'salve', title: 'Green Salve', active: true, text: 'Once per play phase, discard a hand card to let a wounded player recover 1 HP.' },
    ],
  },
}

export const HERO_IDS = Object.keys(HEROES) as HeroId[]

export const KINGDOM_LABEL: Record<Kingdom, string> = { shu: 'Shu', wei: 'Wei', wu: 'Wu', qun: 'Neutral' }
export const ROLE_LABEL: Record<Role, string> = { lord: 'Lord', loyalist: 'Loyalist', rebel: 'Rebel', spy: 'Spy' }

export function rolesFor(n: number): Role[] {
  const table: Record<number, Role[]> = {
    2: ['lord', 'rebel'],
    3: ['lord', 'rebel', 'spy'],
    4: ['lord', 'loyalist', 'rebel', 'spy'],
    5: ['lord', 'loyalist', 'rebel', 'rebel', 'spy'],
    6: ['lord', 'loyalist', 'rebel', 'rebel', 'rebel', 'spy'],
    7: ['lord', 'loyalist', 'loyalist', 'rebel', 'rebel', 'rebel', 'spy'],
    8: ['lord', 'loyalist', 'loyalist', 'rebel', 'rebel', 'rebel', 'rebel', 'spy'],
  }
  return table[n] ?? table[8]
}

export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 8
