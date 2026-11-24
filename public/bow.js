/*
 * The bow, for the side and plan views. Shapes are in metres, in the same frame
 * as the rode drawing: x runs from the anchor towards the boat, so the bow points
 * towards smaller x, and y is height above the seabed.
 *
 *   modern       a yacht bow: raked stem, fin keel cut off at the edge of the view
 *   doubleEnder  a traditional double-ender like the Norwegian rescue boats (Colin
 *                Archer type): a near-upright stem curving into a long, deep keel,
 *                the sheer rising to the bow, a bowsprit with its bobstay, and a
 *                pointed stern in the plan view
 */
window.Bow = (function () {
  // A smooth curve through the given points (Catmull-Rom), as a list of points
  function smooth (pts, steps = 6) {
    const out = [pts[0]]
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[Math.min(pts.length - 1, i + 2)]
      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        const t2 = t * t
        const t3 = t2 * t
        out.push([0, 1].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)))
      }
    }
    return out
  }

  /*
   * Side view.
   *   x, y      the stem head, where the rode comes aboard (the roller)
   *   surface   height of the waterline above the seabed
   *   extent    how much of the boat to show, from the stem aft, m
   *   draft     the boat's draft, m (optional)
   *   length    the boat's length, m (optional, for the bowsprit)
   * Returns { hull: [[x, y], ...] polygon, sprit: [[x, y], [x, y]] or null, bobstay: same }
   */
  function side (style, { x, y, surface, extent, draft, length }) {
    const freeboard = y - surface
    if (style === 'doubleEnder') {
      const d = Math.min(Number.isFinite(draft) ? draft : 0.16 * extent + 0.6, surface - 0.2)
      const keel = surface - Math.max(0.3, d)
      const stem = smooth([
        [x - 0.05, y + 0.12], // stem head, just above the roller
        [x + 0.02, surface + freeboard * 0.45],
        [x + 0.18, surface],
        [x + 0.6, surface - (surface - keel) * 0.45],
        [x + 1.5, surface - (surface - keel) * 0.85],
        [x + 2.8, keel]
      ])
      // the sheer: highest at the stem, falling gently aft
      const sheer = smooth([[x + extent, y - 0.35 - 0.04 * extent], [x + extent * 0.5, y - 0.2], [x + 0.6, y + 0.05], [x - 0.05, y + 0.12]], 4)
      const hull = stem.concat([[x + extent, keel - 0.05 * extent / 4]], sheer.slice(0, -1))
      // bowsprit outboard of the stem: about a quarter of the boat's length
      const spritLength = Math.max(2, Math.min(6, 0.27 * (Number.isFinite(length) ? length : 2 * extent)))
      const tip = [x - spritLength, y + 0.35]
      return {
        hull,
        sprit: [[x + 0.8, y + 0.05], tip],
        bobstay: [tip, [x + 0.12, surface + 0.15]]
      }
    }
    const deck = y + 0.3
    const keel = Math.max(surface - 1.5, 0.3)
    return {
      hull: [[x, y], [x + 0.3, deck], [x + extent, deck + 0.2], [x + extent, keel], [x + extent * 0.35, keel], [x + 0.6, surface - 0.3]],
      sprit: null,
      bobstay: null
    }
  }

  /*
   * Plan view outline, as [forward, starboard] in metres from the bow, for a boat
   * of length L and beam B. Also returns the bowsprit as a line, or null.
   */
  function plan (style, L, B) {
    if (style === 'doubleEnder') {
      const half = smooth([[0, 0], [-0.12 * L, 0.33 * B], [-0.32 * L, 0.5 * B], [-0.6 * L, 0.49 * B], [-0.85 * L, 0.3 * B], [-L, 0]], 4)
      const outline = half.concat(half.slice(1, -1).reverse().map(([f, s]) => [f, -s]))
      return { outline, sprit: [[0, 0], [0.28 * L, 0]] }
    }
    return {
      outline: [[0, 0], [-0.25 * L, B / 2], [-0.7 * L, B / 2], [-L, B * 0.4], [-L, -B * 0.4], [-0.7 * L, -B / 2], [-0.25 * L, -B / 2]],
      sprit: null
    }
  }

  return { side, plan }
})()
