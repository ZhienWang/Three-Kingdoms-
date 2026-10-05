import { CARD_INFO, HEROES, KINGDOM_LABEL, RANK_LABEL, SUIT_SYMBOL, card, colorOf } from '@/convex/game/defs'
import type { CardName, HeroId } from '@/convex/game/defs'
import { CARD_CJK, HERO_CJK, KINGDOM_BG, KINGDOM_CJK, cardArt, heroArt } from '@/lib/game-ui'
import { cn } from '@/lib/utils'

const TYPE_LABEL: Record<string, string> = {
  basic: 'Basic',
  trick: 'Trick',
  delayed: 'Delayed trick',
  weapon: 'Weapon',
  armor: 'Armor',
  horsePlus: 'Horse',
  horseMinus: 'Horse',
}

export function cardTooltip(id: number) {
  const c = card(id)
  const info = CARD_INFO[c.name]
  return `${info.title} (${SUIT_SYMBOL[c.suit]}${RANK_LABEL[c.rank]}): ${info.text}`
}

/**
 * A playing card: rice paper, woodblock print window, cinnabar seal with the
 * Chinese name, suit and rank in the corner. Width drives everything (5:7).
 */
export function GameCard({
  id,
  name,
  width = 112,
  selected,
  dimmed,
  onClick,
  className,
  showText = false,
}: {
  id?: number
  name?: CardName
  width?: number
  selected?: boolean
  dimmed?: boolean
  onClick?: () => void
  className?: string
  showText?: boolean
}) {
  const c = id != null ? card(id) : null
  const cname = (c?.name ?? name)!
  const info = CARD_INFO[cname]
  const red = c ? colorOf(c.suit) === 'red' : false
  const small = width < 90
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={id != null ? cardTooltip(id) : `${info.title}: ${info.text}`}
      aria-pressed={onClick ? !!selected : undefined}
      className={cn(
        'paper relative shrink-0 select-none overflow-hidden rounded-md text-left transition-transform duration-150',
        'shadow-[0_6px_14px_-6px_rgba(0,0,0,0.7)]',
        onClick && 'cursor-pointer hover:-translate-y-1',
        selected && '-translate-y-3 ring-2 ring-gold hover:-translate-y-3',
        dimmed && 'opacity-45 saturate-50',
        className,
      )}
      style={{ width, height: Math.round(width * 1.4) }}
    >
      <div
        className="absolute overflow-hidden rounded-[3px] border border-ink/70 bg-ink"
        style={{ left: '6%', right: '6%', top: '5%', height: '62%' }}
      >
        <img src={cardArt(cname)} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
      </div>
      {c && (
        <div
          className={cn(
            'absolute flex flex-col items-center rounded-sm bg-rice/90 font-semibold leading-none',
            red ? 'text-suit-red' : 'text-ink',
          )}
          style={{ left: '8%', top: '7%', padding: small ? '2px 2px' : '3px 3px', fontSize: small ? 10 : 13 }}
        >
          <span>{RANK_LABEL[c.rank]}</span>
          <span>{SUIT_SYMBOL[c.suit]}</span>
        </div>
      )}
      <div
        className="seal absolute flex items-center justify-center rounded-[3px] text-center leading-none [writing-mode:vertical-rl]"
        style={{
          right: '8%',
          top: '7%',
          padding: small ? '3px 2px' : '5px 3px',
          fontSize: Math.max(10, Math.round(width * (CARD_CJK[cname].length > 2 ? 0.105 : 0.14))),
        }}
      >
        {CARD_CJK[cname]}
      </div>
      <div className="absolute inset-x-0 flex flex-col items-center px-1 text-center" style={{ top: '69%' }}>
        <span className="font-semibold leading-tight text-ink" style={{ fontSize: Math.max(9.5, width * 0.112) }}>
          {info.title}
        </span>
        {!small && (
          <span className="italic leading-tight text-ink-soft" style={{ fontSize: Math.max(9, width * 0.085) }}>
            {TYPE_LABEL[info.type]}
            {info.range ? `, range ${info.range}` : ''}
          </span>
        )}
        {showText && (
          <span className="mt-1 leading-snug text-ink" style={{ fontSize: Math.max(9, width * 0.075) }}>
            {info.text}
          </span>
        )}
      </div>
    </Tag>
  )
}

/** Face-down card back. */
export function CardBack({ width = 72, className }: { width?: number; className?: string }) {
  return (
    <div
      className={cn('relative shrink-0 overflow-hidden rounded-md bg-cinnabar shadow-md', className)}
      style={{ width, height: Math.round(width * 1.4) }}
    >
      <div className="absolute inset-[6%] flex items-center justify-center rounded-[3px] border border-gold/70">
        <span className="font-brush text-gold" style={{ fontSize: width * 0.42 }}>
          三国
        </span>
      </div>
    </div>
  )
}

/** Hero portrait card used for hero selection and seat fallbacks. */
export function HeroCard({
  hero,
  width = 160,
  selected,
  onClick,
  showSkills = true,
}: {
  hero: HeroId
  width?: number
  selected?: boolean
  onClick?: () => void
  showSkills?: boolean
}) {
  const h = HEROES[hero]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group relative flex shrink-0 flex-col overflow-hidden rounded-lg text-left',
        'bg-ink shadow-[0_10px_24px_-10px_rgba(0,0,0,0.8)] transition-transform',
        onClick && 'cursor-pointer hover:-translate-y-1',
        selected ? 'ring-2 ring-gold' : 'ring-1 ring-gold/40',
      )}
      style={{ width }}
    >
      <div className="relative" style={{ height: Math.round(width * 1.25) }}>
        <img src={heroArt(hero)} alt={h.name} loading="lazy" className="h-full w-full object-cover" draggable={false} />
        <div className={cn('absolute left-2 top-2 flex size-7 items-center justify-center rounded-full font-brush text-lg text-rice', KINGDOM_BG[h.kingdom])} title={KINGDOM_LABEL[h.kingdom]}>
          {KINGDOM_CJK[h.kingdom]}
        </div>
        <div className="seal absolute right-2 top-2 rounded-[3px] px-1 py-1.5 text-lg leading-none [writing-mode:vertical-rl]">
          {HERO_CJK[hero]}
        </div>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/80 to-transparent px-3 pb-2 pt-8">
          <div className="text-lg font-semibold leading-tight text-rice">{h.name}</div>
          <div className="flex items-center gap-1 text-sm text-rice-dim">
            <span>{KINGDOM_LABEL[h.kingdom]}</span>
            <span aria-hidden className="ml-1 flex gap-0.5">
              {Array.from({ length: h.hp }, (_, i) => (
                <span key={i} className="inline-block size-2 rounded-full bg-cinnabar-bright" />
              ))}
            </span>
            <span className="sr-only">{h.hp} HP</span>
          </div>
        </div>
      </div>
      {showSkills && (
        <div className="paper flex-1 space-y-1.5 px-3 py-2 text-[13px] leading-snug">
          {h.skills.map((s) => (
            <p key={s.id}>
              <span className="font-semibold">{s.title}.</span> {s.text}
            </p>
          ))}
        </div>
      )}
    </Tag>
  )
}
