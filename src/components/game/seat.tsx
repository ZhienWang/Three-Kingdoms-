import { CARD_INFO, HEROES, ROLE_LABEL, card } from '@/convex/game/defs'
import type { ViewPlayer } from '@/convex/game/engine'
import { HERO_CJK, KINGDOM_RING, ROLE_CJK, heroArt } from '@/lib/game-ui'
import { cn } from '@/lib/utils'
import { cardTooltip } from './cards'
import { VideoTile } from './video'

const ROLE_STYLE: Record<string, string> = {
  lord: 'bg-gold text-ink',
  loyalist: 'bg-wei text-rice',
  rebel: 'bg-wu text-rice',
  spy: 'bg-qun text-ink',
}

export function HpPips({ hp, max, className }: { hp: number; max: number; className?: string }) {
  return (
    <span className={cn('flex items-center gap-[3px]', className)} aria-label={`${hp} of ${max} HP`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={cn(
            'inline-block size-2.5 rounded-full border',
            i < hp ? (hp <= 1 ? 'border-cinnabar-bright bg-cinnabar-bright' : 'border-wu bg-wu') : 'border-rice/40 bg-transparent',
          )}
        />
      ))}
    </span>
  )
}

export function Seat({
  p,
  stream,
  cameraOn,
  isMe,
  isCurrent,
  waiting,
  selectable,
  selected,
  hit,
  reach,
  compact,
  onClick,
  connection,
  className,
}: {
  p: ViewPlayer
  stream?: MediaStream | null
  cameraOn: boolean
  isMe?: boolean
  isCurrent?: boolean
  waiting?: boolean
  selectable?: boolean
  selected?: boolean
  hit?: boolean
  /** Distance from the viewer, whether they can Attack this seat, and why a selected card can't target it. */
  reach?: { distance: number; inAttackRange: boolean; blocked?: string }
  /** Shorter video tile, used around the oval table. */
  compact?: boolean
  onClick?: () => void
  connection?: 'connecting' | 'connected' | 'failed' | 'offline'
  className?: string
}) {
  const hero = p.hero ? HEROES[p.hero] : null
  const equip = (Object.entries(p.equip) as [string, number | null][]).filter(([, v]) => v != null) as [string, number][]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      disabled={onClick ? !selectable : undefined}
      className={cn(
        'group relative flex min-w-0 flex-col overflow-hidden rounded-lg bg-ink text-left ring-2 transition',
        hero ? KINGDOM_RING[hero.kingdom] : 'ring-jade-soft',
        isCurrent && 'turn-glow',
        selectable && 'cursor-pointer hover:brightness-110',
        onClick && !selectable && 'cursor-default opacity-60',
        selected && 'ring-4 ring-gold',
        !p.alive && 'grayscale',
        className,
      )}
    >
      <VideoTile
        stream={stream}
        muted={isMe}
        mirrored={isMe}
        visible={cameraOn && !!stream}
        className={cn(compact ? 'aspect-[16/10] w-full' : 'aspect-[4/3] w-full', hit && 'hit-flash')}
        fallback={
          hero ? (
            <img src={heroArt(p.hero!)} alt="" className="h-full w-full object-cover object-top" draggable={false} />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-jade">
              <span className="font-brush text-4xl text-rice/70">{p.name.slice(0, 1)}</span>
            </div>
          )
        }
      />

      {/* role seal and hand count */}
      <div className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1">
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-[4px] font-brush text-sm leading-none',
            p.role ? ROLE_STYLE[p.role] : 'bg-ink/70 text-rice/70',
          )}
          title={p.role ? ROLE_LABEL[p.role] : 'Hidden role'}
        >
          {p.role ? ROLE_CJK[p.role] : '?'}
        </span>
        {connection && connection !== 'connected' && !isMe && (
          <span className="rounded bg-ink/75 px-1 text-[10px] text-rice-dim">
            {connection === 'offline' ? 'offline' : connection === 'failed' ? 'no video' : 'linking'}
          </span>
        )}
      </div>
      <div className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-ink/75 px-1.5 py-0.5 text-xs text-rice">
        <span className="inline-block h-3 w-2 rounded-[2px] bg-cinnabar ring-1 ring-gold/60" aria-hidden />
        <span aria-label={`${p.handCount} cards in hand`}>{p.handCount}</span>
      </div>
      {reach && (
        <div
          className={cn(
            'absolute right-1.5 top-8 rounded px-1.5 py-0.5 text-xs font-semibold leading-none',
            reach.inAttackRange ? 'bg-gold text-ink' : 'bg-ink/80 text-rice-dim ring-1 ring-rice/25',
          )}
          title={`${reach.distance} away from you. ${reach.inAttackRange ? 'Within your attack range.' : 'Outside your attack range.'}`}
        >
          {reach.distance} away
        </div>
      )}
      {reach?.blocked && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-cinnabar/90 px-2 py-0.5 text-center text-xs font-semibold text-rice">
          {reach.blocked}
        </div>
      )}
      {!p.alive && (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 text-center font-brush text-3xl text-cinnabar-bright drop-shadow">
          阵亡
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-1 bg-gradient-to-b from-ink to-jade-deep px-2 py-1.5">
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-rice">
            {p.name}
            {isMe && <span className="font-normal text-rice-dim"> (you)</span>}
          </span>
          {p.alive && p.maxHp > 0 && <HpPips hp={p.hp} max={p.maxHp} />}
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-rice-dim">
          <span className="truncate">
            {hero ? (
              <>
                {hero.name} <span className="font-brush">{HERO_CJK[p.hero!]}</span>
              </>
            ) : (
              'Choosing a hero'
            )}
          </span>
          {waiting && <span className="shrink-0 italic text-gold">deciding</span>}
        </div>
        {(equip.length > 0 || p.judge.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {p.judge.map((id) => (
              <span key={id} title={cardTooltip(id)} className="seal rounded px-1 text-[11px] leading-5">
                {CARD_INFO[card(id).name].title}
              </span>
            ))}
            {equip.map(([slot, id]) => (
              <span key={slot} title={cardTooltip(id)} className="paper max-w-full truncate rounded px-1 text-[11px] leading-5">
                {CARD_INFO[card(id).name].title}
              </span>
            ))}
          </div>
        )}
      </div>
    </Tag>
  )
}
