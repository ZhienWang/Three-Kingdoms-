import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { CARD_INFO, HEROES } from '@/convex/game/defs'
import type { CardName, HeroId } from '@/convex/game/defs'

export const Route = createFileRoute('/credits')({ component: Credits })

interface Credit {
  file: string
  page: string
  width: number
  height: number
  license: string
  artist: string
  date: string
  upscaled?: boolean
}

function Credits() {
  const [credits, setCredits] = useState<Record<string, Credit> | null>(null)
  useEffect(() => {
    fetch('/art/credits.json')
      .then((r) => r.json())
      .then(setCredits)
      .catch(() => setCredits({}))
  }, [])
  const label = (key: string) => {
    const [kind, id] = key.split(':')
    return kind === 'hero' ? `Hero: ${HEROES[id as HeroId].name}` : `Card: ${CARD_INFO[id as CardName].title}`
  }
  return (
    <div className="table-felt min-h-dvh px-5 py-10 text-rice">
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="font-brush text-3xl text-gold">
          三国
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">Art credits</h1>
        <p className="mt-2 max-w-[38rem] leading-relaxed text-rice-dim">
          Every image in the game is a crop of a work in the public domain or released under CC0, sourced from Wikimedia Commons. The
          originals include woodblock prints by Utagawa Kuniyoshi, Tsukioka Yoshitoshi and Yashima Gakutei, a Hokusai painting held by the
          Metropolitan Museum of Art, and Qing dynasty portraits and illustrations of the Romance of the Three Kingdoms.
        </p>
        {!credits ? (
          <p className="mt-6 text-rice-dim">Loading…</p>
        ) : (
          <ul className="mt-6 divide-y divide-border/60">
            {Object.entries(credits).map(([key, c]) => (
              <li key={key} className="py-3 text-sm">
                <p className="font-semibold">{label(key)}</p>
                <p className="text-rice-dim">
                  {c.artist.replace(/^(.+?)\1$/, '$1') || 'Unknown artist'}
                  {c.date ? `, ${c.date}` : ''}. {c.license}.{' '}
                  <a href={c.page} target="_blank" rel="noreferrer" className="text-gold underline underline-offset-2">
                    {c.file}
                  </a>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
