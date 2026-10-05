// Lists public-domain/CC0 images (>= minPx long side) in Commons categories,
// including one level of subcategories.
// Usage: node scripts/art/category.mjs "Category:Zhou Yu" ["Category:..."]
const UA = 'ThreeKingdomsDuel/1.0 (indie game dev; https://macaly.com)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const minPx = Number(process.env.MIN_PX || 1200)
async function api(params) {
  const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ format: 'json', ...params })
  for (let t = 0; t < 6; t++) {
    const r = await fetch(u, { headers: { 'User-Agent': UA } })
    const s = await r.text()
    if (s.startsWith('{')) return JSON.parse(s)
    await sleep(5000)
  }
  throw new Error('rate limited')
}
async function files(cat) {
  const d = await api({
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: cat,
    gcmtype: 'file',
    gcmlimit: '100',
    prop: 'imageinfo',
    iiprop: 'size|mime|extmetadata',
    iiextmetadatafilter: 'LicenseShortName',
  })
  return Object.values(d.query?.pages || {})
}
for (const cat of process.argv.slice(2)) {
  const subs = await api({ action: 'query', list: 'categorymembers', cmtitle: cat, cmtype: 'subcat', cmlimit: '50' })
  const cats = [cat, ...(subs.query?.categorymembers || []).map((c) => c.title)]
  console.log('##', cat, '| subcats:', cats.length - 1)
  for (const c of cats) {
    const ps = await files(c)
    for (const p of ps) {
      const i = p.imageinfo?.[0]
      if (!i || !/image/.test(i.mime)) continue
      const l = i.extmetadata?.LicenseShortName?.value || ''
      if (!/public domain|PD|CC0/i.test(l)) continue
      if (Math.max(i.width, i.height) < minPx) continue
      console.log(`  ${i.width}x${i.height} [${l}] ${c === cat ? '' : '(' + c.slice(9) + ') '}${p.title.slice(5, 150)}`)
    }
    await sleep(900)
  }
}
