/*
 * The boat, for the side and plan views. Shapes are in metres, in the same frame
 * as the rode drawing: x runs from the anchor towards the boat, so the bow points
 * towards smaller x, and y is height above the seabed.
 *
 *   modern       a yacht bow: raked stem, fin keel cut off at the edge of the view
 *   doubleEnder  a traditional double-ender like the Norwegian rescue boats (Colin
 *                Archer type): the RS 21 Solli logo, drawn from her rigging drawing:
 *                hull and rig as at anchor, sails down, without the bowsprit; a
 *                pointed stern in the plan view
 */
window.Bow = (function () {
  // The RS 21 Solli logo's hull, bow to the right, in the logo's units (y down).
  // The roller is at the stem head; the hull runs 1978 units from stern to stem.
  const LOGO = {
    stemHead: [2286, 2318],
    length: 1978,
    hull: 'M 322 2412 C 400 2418 500 2420 558 2416 C 594 2412 610 2384 656 2380 C 1010 2390 1420 2374 1800 2326 ' +
      'C 1915 2314 1990 2302 2052 2295 C 2084 2291 2096 2318 2126 2327 C 2178 2338 2250 2326 2286 2318 ' +
      'C 2304 2350 2298 2380 2278 2406 C 2252 2462 2200 2522 2122 2576 L 478 2601 C 395 2528 374 2465 368 2398 L 322 2386 Z',
    lines: [
      'M 322 2414 C 334 2452 342 2510 343 2570 C 344 2586 352 2598 370 2601 L 478 2601', // rudder
      'M 330 2408 L 330 2396 L 362 2394 L 362 2406', // stern rail
      'M 372 2416 C 900 2480 1750 2420 2286 2320' // sheer strake
    ],
    // At anchor, sails down: masts, booms, and the gaffs lowered to rest just
    // above the booms, pointing aft a few degrees up from them (the logo's gaff
    // lengths, 804 and 425). The staysail stay runs to the stem head.
    rig: [
      'M 1484 270 L 1536 2352', 'M 1501 270 L 1577 2351', // mainmast
      'M 628 1302 L 621 2380', 'M 649 1302 L 645 2379', // mizzen mast
      'M 701 2134 L 1532 2196', 'M 1530 2131 L 739 1988', // main boom, lowered gaff
      'M 118 2166 L 622 2233', 'M 622 2168 L 209 2068', // mizzen boom, lowered gaff
      'M 1527 992 L 2292 2282' // staysail stay
    ],
    caps: [[1490, 252, 10], [641, 1290, 10]], // mast heads
    // furled sails, laced to each lowered gaff above its boom: [boom at mast, boom end, throat, peak]
    furled: [
      [[1532, 2196], [701, 2134], [1530, 2131], [739, 1988]],
      [[622, 2233], [118, 2166], [622, 2168], [209, 2068]]
    ]
  }

  // Points along an SVG path of absolute M, L, C and Z commands
  function sample (d, steps = 10) {
    const t = d.match(/[MLCZ]|-?[\d.]+/g)
    const pts = []
    let i = 0
    let cmd
    let cur = [0, 0]
    let start = [0, 0]
    const num = () => Number(t[i++])
    while (i < t.length) {
      if (/[MLCZ]/.test(t[i])) cmd = t[i++]
      if (cmd === 'M') { cur = start = [num(), num()]; pts.push(cur); cmd = 'L' } else if (cmd === 'L') { cur = [num(), num()]; pts.push(cur) } else if (cmd === 'C') {
        const p1 = [num(), num()]
        const p2 = [num(), num()]
        const p3 = [num(), num()]
        const p0 = cur
        for (let s = 1; s <= steps; s++) {
          const u = s / steps
          const a = (1 - u) ** 3
          const b = 3 * (1 - u) ** 2 * u
          const c = 3 * (1 - u) * u * u
          const e = u ** 3
          pts.push([0, 1].map(k => a * p0[k] + b * p1[k] + c * p2[k] + e * p3[k]))
        }
        cur = p3
      } else if (cmd === 'Z') { pts.push(start); cur = start }
    }
    return pts
  }
  // A smooth curve through the given points (Catmull-Rom)
  function smooth (pts, steps = 4) {
    const out = [pts[0]]
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[Math.min(pts.length - 1, i + 2)]
      for (let k = 1; k <= steps; k++) {
        const u = k / steps
        out.push([0, 1].map(j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u * u + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * u * u * u)))
      }
    }
    return out
  }

  const logoHull = sample(LOGO.hull)
  const logoLines = LOGO.lines.map(d => sample(d))
  const logoRig = LOGO.rig.map(d => sample(d))

  /*
   * A gaff sail, lowered and furled: laced to the gaff, it hangs below it, deep
   * enough at the mast to lie on the boom and thinner towards the peak, sagging
   * a little between the ties around the gaff. Returns the bundle's outline and
   * the ties.
   */
  function furl ([boomA, boomB, gaffA, gaffB]) {
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    const start = 0.03
    const end = 0.92
    const ties = 4 // stretches between ties
    const top = []
    const bottom = []
    const tieLines = []
    for (let i = 0; i <= 48; i++) {
      const t = start + (end - start) * i / 48
      const g = lerp(gaffA, gaffB, t) // on the gaff
      const b = lerp(boomA, boomB, t) // the boom below it
      const along = (t - start) / (end - start)
      const sag = Math.sin(Math.PI * ((along * ties) % 1)) ** 2 // hangs lower between ties
      // depth below the gaff, as a share of the gap down to the boom
      const depth = Math.min(0.92, 0.88 - 0.6 * along + 0.1 * sag)
      top.push(lerp(g, b, 0.03))
      bottom.push(lerp(g, b, depth))
      if (i > 0 && i < 48 && i % (48 / ties) === 0) tieLines.push([lerp(g, b, -0.04), lerp(g, b, depth - 0.02)])
    }
    return { outline: top.concat(bottom.reverse()), ties: tieLines }
  }
  const logoFurled = LOGO.furled.map(furl)

  /*
   * Side view.
   *   x, y      the stem head, where the rode comes aboard (the roller)
   *   surface   height of the waterline above the seabed
   *   extent    how much of a modern hull to show, from the stem aft, m
   *   length    the boat's length, m (optional)
   * Returns { hull: [[x, y], ...] polygon, lines: [[[x, y], ...], ...], length,
   *           rig: { lines, circles: [{ x, y, r }], furled: [{ outline, ties }] } or null }
   */
  function side (style, { x, y, surface, extent, length }) {
    if (style === 'doubleEnder') {
      const L = Number.isFinite(length) && length > 0 ? length : 14
      const s = L / LOGO.length
      // mirrored so the bow faces the anchor, with the stem head on the roller
      const map = ([u, v]) => [x + (LOGO.stemHead[0] - u) * s, y - (v - LOGO.stemHead[1]) * s]
      const circle = ([u, v, r]) => { const [cx, cy] = map([u, v]); return { x: cx, y: cy, r: r * s } }
      return {
        hull: logoHull.map(map),
        lines: logoLines.map(l => l.map(map)),
        length: L,
        rig: {
          lines: logoRig.map(l => l.map(map)),
          circles: LOGO.caps.map(circle),
          furled: logoFurled.map(f => ({ outline: f.outline.map(map), ties: f.ties.map(l => l.map(map)) }))
        }
      }
    }
    const deck = y + 0.3
    const keel = Math.max(surface - 1.5, 0.3)
    return {
      hull: [[x, y], [x + 0.3, deck], [x + extent, deck + 0.2], [x + extent, keel], [x + extent * 0.35, keel], [x + 0.6, surface - 0.3]],
      lines: [],
      length: extent,
      rig: null
    }
  }

  /*
   * Plan view outline, as [forward, starboard] in metres from the bow, for a boat
   * of length L and beam B.
   */
  function plan (style, L, B) {
    if (style === 'doubleEnder') {
      const half = [[0, 0], [-0.12 * L, 0.33 * B], [-0.32 * L, 0.5 * B], [-0.6 * L, 0.49 * B], [-0.85 * L, 0.3 * B], [-L, 0]]
      const curve = smooth(half)
      return { outline: curve.concat(curve.slice(1, -1).reverse().map(([f, st]) => [f, -st])) }
    }
    return { outline: [[0, 0], [-0.25 * L, B / 2], [-0.7 * L, B / 2], [-L, B * 0.4], [-L, -B * 0.4], [-0.7 * L, -B / 2], [-0.25 * L, -B / 2]] }
  }

  return { side, plan }
})()
