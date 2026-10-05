// Downloads the public-domain / CC0 artworks listed in sources.json from
// Wikimedia Commons, recording license + artist metadata for attribution.
// Usage: node scripts/art/download.mjs <outDir>
import fs from 'node:fs'
import path from 'node:path'

const UA = 'ThreeKingdomsDuel/1.0 (indie game dev; https://macaly.com)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const here = path.dirname(new URL(import.meta.url).pathname)
const files = JSON.parse(fs.readFileSync(path.join(here, 'sources.json'), 'utf8'))
const outDir = process.argv[2] || '/tmp/art/src'
fs.mkdirSync(outDir, { recursive: true })

async function api(params) {
  const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ format: 'json', ...params })
  for (let t = 0; t < 6; t++) {
    const r = await fetch(u, { headers: { 'User-Agent': UA } })
    const s = await r.text()
    if (s.startsWith('{')) return JSON.parse(s)
    await sleep(5000)
  }
  throw new Error('Commons API rate limited')
}

const strip = (v) => (v || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const meta = {}
const keys = Object.keys(files)
for (let i = 0; i < keys.length; i += 20) {
  const batch = keys.slice(i, i + 20)
  const j = await api({
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiextmetadatafilter: 'LicenseShortName|Artist|DateTimeOriginal|ObjectName',
    iiurlwidth: '2400',
    titles: batch.map((k) => 'File:' + files[k]).join('|'),
  })
  const norm = {}
  for (const n of j.query.normalized || []) norm[n.to] = n.from
  for (const p of Object.values(j.query.pages)) {
    const key = batch.find((k) => 'File:' + files[k] === (norm[p.title] || p.title))
    if (!p.imageinfo) {
      console.log('MISSING', key, p.title)
      continue
    }
    const ii = p.imageinfo[0]
    const e = ii.extmetadata || {}
    meta[key] = {
      file: files[key],
      page: ii.descriptionurl,
      url: ii.thumburl || ii.url,
      width: ii.width,
      height: ii.height,
      license: strip(e.LicenseShortName?.value),
      artist: strip(e.Artist?.value).slice(0, 100),
      date: strip(e.DateTimeOriginal?.value).slice(0, 60),
    }
  }
  await sleep(1500)
}
fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 1))

for (const [k, m] of Object.entries(meta)) {
  const out = path.join(outDir, `${k}.img`)
  if (fs.existsSync(out)) continue
  for (let t = 0; t < 5; t++) {
    const r = await fetch(m.url, { headers: { 'User-Agent': UA } })
    if (r.ok) {
      fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()))
      console.log('ok', k, m.license, `${m.width}x${m.height}`)
      break
    }
    console.log('retry', k, r.status)
    await sleep(4000)
  }
  await sleep(800)
}
