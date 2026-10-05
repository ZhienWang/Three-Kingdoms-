import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/** A <video> bound to a MediaStream. Remote tiles play audio; the local one is muted. */
export function VideoTile({
  stream,
  muted,
  mirrored,
  visible,
  className,
  fallback,
}: {
  stream: MediaStream | null | undefined
  muted?: boolean
  mirrored?: boolean
  visible: boolean
  className?: string
  fallback: React.ReactNode
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== (stream ?? null)) el.srcObject = stream ?? null
    if (stream) {
      el.play()
        .then(() => setBlocked(false))
        .catch(() => setBlocked(true))
    }
  }, [stream])
  return (
    <div className={cn('relative overflow-hidden bg-ink', className)}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={cn('absolute inset-0 h-full w-full object-cover', mirrored && '-scale-x-100', !visible && 'opacity-0')}
      />
      {!visible && <div className="absolute inset-0">{fallback}</div>}
      {blocked && stream && !muted && (
        <button
          type="button"
          onClick={() => ref.current?.play().then(() => setBlocked(false)).catch(() => {})}
          className="absolute inset-x-2 bottom-2 rounded bg-ink/85 px-2 py-1 text-xs text-rice"
        >
          Tap to hear
        </button>
      )}
    </div>
  )
}
