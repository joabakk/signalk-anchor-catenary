/*
 * The boat, for the side and plan views. Shapes are in metres, in the same frame
 * as the rode drawing: x runs from the anchor towards the boat, so the bow points
 * towards smaller x, and y is height above the seabed.
 *
 *   modern       a yacht bow: raked stem, fin keel cut off at the edge of the view
 *   doubleEnder  a traditional double-ender like the Norwegian rescue boats (Colin
 *                Archer type): the hull of the RS 21 Solli logo, drawn from her
 *                rigging drawing, without the rig and bowsprit; a pointed stern in
 *                the plan view
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

  /*
   * Side view.
   *   x, y      the stem head, where the rode comes aboard (the roller)
   *   surface   height of the waterline above the seabed
   *   extent    how much of a modern hull to show, from the stem aft, m
   *   length    the boat's length, m (optional)
   * Returns { hull: [[x, y], ...] polygon, lines: [[[x, y], ...], ...], length }
   */
  function side (style, { x, y, surface, extent, length }) {
    if (style === 'doubleEnder') {
      const L = Number.isFinite(length) && length > 0 ? length : 14
      const s = L / LOGO.length
      // mirrored so the bow faces the anchor, with the stem head on the roller
      const map = ([u, v]) => [x + (LOGO.stemHead[0] - u) * s, y - (v - LOGO.stemHead[1]) * s]
      return { hull: logoHull.map(map), lines: logoLines.map(l => l.map(map)), length: L }
    }
    const deck = y + 0.3
    const keel = Math.max(surface - 1.5, 0.3)
    return {
      hull: [[x, y], [x + 0.3, deck], [x + extent, deck + 0.2], [x + extent, keel], [x + extent * 0.35, keel], [x + 0.6, surface - 0.3]],
      lines: [],
      length: extent
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
