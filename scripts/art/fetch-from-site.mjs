// Downloads the processed card and hero art from the live deployment into public/art.
// The images are not committed to the repo; run this once after cloning:
//   node scripts/art/fetch-from-site.mjs [baseUrl]
// To rebuild them from the original Wikimedia Commons sources instead, see
// scripts/art/download.mjs and scripts/art/process.py.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const base = (process.argv[2] || 'https://b46il6zznx5ht3o4st1xn6a4.macaly.app').replace(/\/$/, '')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const credits = JSON.parse(await readFile(path.join(root, 'public/art/credits.json'), 'utf8'))

let ok = 0
for (const key of Object.keys(credits)) {
  const [kind, name] = key.split(':')
  const rel = `art/${kind === 'hero' ? 'heroes' : 'cards'}/${name}.webp`
  const res = await fetch(`${base}/${rel}`)
  if (!res.ok) { console.error(`failed ${rel}: ${res.status}`); continue }
  const out = path.join(root, 'public', rel)
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, Buffer.from(await res.arrayBuffer()))
  ok++
}
console.log(`downloaded ${ok}/${Object.keys(credits).length} images to public/art`)
