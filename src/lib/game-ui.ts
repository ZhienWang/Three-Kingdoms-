// Client-side presentation helpers: art paths, Chinese titles, identity.
import { useEffect, useState } from 'react'
import type { CardName, HeroId, Kingdom, Role } from '@/convex/game/defs'

export const CARD_CJK: Record<CardName, string> = {
  attack: '杀',
  dodge: '闪',
  peach: '桃',
  duel: '决斗',
  dismantle: '过河拆桥',
  steal: '顺手牵羊',
  barbarians: '南蛮入侵',
  arrows: '万箭齐发',
  peachgarden: '桃园结义',
  drawtwo: '无中生有',
  negate: '无懈可击',
  indulgence: '乐不思蜀',
  lightning: '闪电',
  crossbow: '诸葛连弩',
  bluesteel: '青釭剑',
  greendragon: '青龙偃月刀',
  serpentspear: '丈八蛇矛',
  rockaxe: '贯石斧',
  halberd: '方天画戟',
  kirinbow: '麒麟弓',
  eighttrigrams: '八卦阵',
  renwang: '仁王盾',
  horseplus: '的卢',
  horseminus: '赤兔',
}

export const HERO_CJK: Record<HeroId, string> = {
  liubei: '刘备',
  guanyu: '关羽',
  zhangfei: '张飞',
  zhugeliang: '诸葛亮',
  zhaoyun: '赵云',
  machao: '马超',
  caocao: '曹操',
  simayi: '司马懿',
  xiahoudun: '夏侯惇',
  zhangliao: '张辽',
  sunquan: '孙权',
  zhouyu: '周瑜',
  huanggai: '黄盖',
  lubu: '吕布',
  diaochan: '貂蝉',
  huatuo: '华佗',
}

export const KINGDOM_CJK: Record<Kingdom, string> = { shu: '蜀', wei: '魏', wu: '吴', qun: '群' }
export const ROLE_CJK: Record<Role, string> = { lord: '主', loyalist: '忠', rebel: '反', spy: '内' }

export const KINGDOM_BG: Record<Kingdom, string> = {
  shu: 'bg-shu',
  wei: 'bg-wei',
  wu: 'bg-wu',
  qun: 'bg-qun',
}
export const KINGDOM_RING: Record<Kingdom, string> = {
  shu: 'ring-shu',
  wei: 'ring-wei',
  wu: 'ring-wu',
  qun: 'ring-qun',
}

export const cardArt = (name: CardName) => `/art/cards/${name}.webp`
export const heroArt = (id: HeroId) => `/art/heroes/${id}.webp`

const TOKEN_KEY = 'tkd.token'
const NAME_KEY = 'tkd.name'

function randomToken() {
  const a = new Uint8Array(16)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** A private per-browser token (acts as the player's key) and a display name. */
export function useIdentity() {
  const [token, setToken] = useState<string | null>(null)
  const [name, setNameState] = useState('')
  useEffect(() => {
    let t = localStorage.getItem(TOKEN_KEY)
    if (!t) {
      t = randomToken()
      localStorage.setItem(TOKEN_KEY, t)
    }
    setToken(t)
    setNameState(localStorage.getItem(NAME_KEY) ?? '')
  }, [])
  const setName = (n: string) => {
    setNameState(n)
    localStorage.setItem(NAME_KEY, n)
  }
  return { token, name, setName, ready: token !== null }
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // Convex wraps thrown errors: "[CONVEX M(...)] ... Uncaught Error: <msg> at handler"
  const m = msg.match(/Uncaught Error: (.*?)(?:\n|\s+at handler|$)/)
  return (m ? m[1] : msg).trim()
}
