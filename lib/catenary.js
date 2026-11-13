/*
 * Catenary of an anchor chain between the anchor (on the seabed) and the bow roller.
 *
 * Coordinates are in a vertical plane through the anchor and the roller:
 * x runs horizontally from the anchor (x = 0) towards the roller (x = span),
 * y is height above the seabed (the anchor is at y = 0, the roller at y = height).
 * The seabed is taken as flat between the two.
 *
 * Given the horizontal span, the height and the length of chain out, the shape
 * is fully determined. Four cases:
 *
 *   slack     the chain is long enough to hang straight down from the roller and
 *             still lie on the bottom all the way to the anchor: no horizontal pull.
 *   catenary  part of the chain lies on the bottom, the rest hangs in a catenary
 *             that touches down tangentially. The anchor gets a horizontal pull.
 *   lifting   all the chain is off the bottom; the chain pulls the anchor shank
 *             upwards (anchorAngle > 0). Holding power drops fast.
 *   taut      the chain is shorter than the straight line from roller to anchor.
 *             Physically impossible, so the inputs disagree (anchor position,
 *             rode length or depth is off). Drawn as a straight line.
 *
 * A catenary with parameter a = H / w (H horizontal tension, w weight per metre
 * in water) has y = a (cosh((x - x0) / a) - 1) around its lowest point x0.
 */

const G = 9.80665
// Steel in sea water: weight in water / weight in air = 1 - 1025 / 7850
const STEEL_IN_SEAWATER = 1 - 1025 / 7850

function bisect (f, lo, hi, iterations = 200) {
  // f(lo) < 0 < f(hi); bisect in log space, a spans many orders of magnitude
  for (let i = 0; i < iterations; i++) {
    const mid = Math.sqrt(lo * hi)
    const fm = f(mid)
    if (fm > 0 || Number.isNaN(fm)) hi = mid
    else lo = mid
    if (hi / lo - 1 < 1e-12) break
  }
  return Math.sqrt(lo * hi)
}

/*
 * solve({ span, height, length, weight })
 *   span    horizontal distance anchor -> roller, m
 *   height  roller height above the seabed, m (water depth at the anchor + roller height)
 *   length  chain out from the roller, m
 *   weight  weight of the chain in water, N/m (optional, for tensions)
 */
function solve ({ span, height, length, weight }) {
  const X = span
  const h = height
  const L = length
  if (![X, h, L].every(Number.isFinite) || X < 0 || h <= 0 || L <= 0) return null
  const w = Number.isFinite(weight) && weight > 0 ? weight : undefined
  const N = v => (w === undefined || !Number.isFinite(v) ? undefined : v)

  const chord = Math.hypot(X, h)
  // Anchor starts to lift when the touchdown point reaches the anchor: the whole
  // chain hangs in a catenary with its lowest point at the anchor (s = L).
  const aLift = (L * L - h * h) / (2 * h)
  const liftSpan = aLift > 0 ? aLift * Math.acosh(1 + h / aLift) : 0
  const common = {
    span: X,
    height: h,
    length: L,
    chord,
    scope: L / h,
    liftSpan, // horizontal distance at which the anchor starts to lift
    maxSpan: L > h ? Math.sqrt(L * L - h * h) : 0, // bar tight
    liftTension: N(w * aLift) // horizontal pull at which the anchor starts to lift
  }

  if (L < chord * (1 - 1e-9)) {
    return Object.assign(common, {
      state: 'taut',
      a: Infinity,
      x0: undefined,
      touchdown: 0,
      onBottom: 0,
      suspended: L,
      anchorAngle: Math.atan2(h, X),
      rollerAngle: Math.atan2(h, X),
      horizontalTension: undefined,
      rollerTension: undefined,
      anchorTension: undefined
    })
  }

  if (L >= X + h) {
    return Object.assign(common, {
      state: 'slack',
      a: 0,
      x0: X,
      touchdown: X,
      onBottom: L - h,
      suspended: h,
      anchorAngle: 0,
      rollerAngle: Math.PI / 2,
      horizontalTension: N(0),
      rollerTension: N(w * h),
      anchorTension: N(0)
    })
  }

  if (liftSpan >= X) {
    // Touchdown between anchor and roller. Suspended part: s = sqrt(h^2 + 2ah),
    // horizontal extent xs = a acosh(1 + h/a); the rest, L - s, lies on the bottom.
    const f = a => a * Math.acosh(1 + h / a) - Math.sqrt(h * h + 2 * a * h) + L - X
    const a = bisect(f, h * 1e-12, aLift)
    const s = Math.sqrt(h * h + 2 * a * h)
    const xs = a * Math.acosh(1 + h / a)
    return Object.assign(common, {
      state: 'catenary',
      a,
      x0: X - xs,
      touchdown: X - xs,
      onBottom: L - s,
      suspended: s,
      anchorAngle: 0,
      rollerAngle: Math.atan(s / a),
      horizontalTension: N(w * a),
      rollerTension: N(w * (a + h)),
      anchorTension: N(w * a)
    })
  }

  // Fully suspended: chain length between two points at different heights,
  // sqrt(L^2 - h^2) = 2a sinh(X / 2a). The lowest point lies behind the anchor.
  const k = Math.sqrt(L * L - h * h)
  const g = a => k - 2 * a * Math.sinh(X / (2 * a)) // increasing in a
  let hi = Math.max(aLift, X, 1)
  while (g(hi) <= 0) hi *= 2
  const a = bisect(g, X * 1e-9, hi)
  const x0 = X / 2 - a * Math.atanh(h / L)
  return Object.assign(common, {
    state: 'lifting',
    a,
    x0,
    touchdown: 0,
    onBottom: 0,
    suspended: L,
    anchorAngle: Math.atan(Math.sinh(-x0 / a)),
    rollerAngle: Math.atan(Math.sinh((X - x0) / a)),
    horizontalTension: N(w * a),
    rollerTension: N(w * a * Math.cosh((X - x0) / a)),
    anchorTension: N(w * a * Math.cosh(x0 / a))
  })
}

// Points [x, y] along the chain from the anchor to the roller, for drawing.
function profile (r, n = 60) {
  if (!r) return []
  const X = r.span
  const h = r.height
  if (r.state === 'taut') return [[0, 0], [X, h]]
  if (r.state === 'slack') return [[0, 0], [X, 0], [X, h]]
  const pts = []
  if (r.state === 'catenary' && r.touchdown > 0) pts.push([0, 0])
  const start = r.state === 'catenary' ? r.touchdown : 0
  const base = r.state === 'catenary' ? 0 : r.a * Math.cosh(-r.x0 / r.a)
  for (let i = 0; i <= n; i++) {
    const x = start + (X - start) * i / n
    const y = r.a * Math.cosh((x - r.x0) / r.a) - (r.state === 'catenary' ? r.a : base)
    pts.push([x, Math.max(0, y)])
  }
  pts[pts.length - 1] = [X, h]
  return pts
}

// Weight in water, N/m, of a chain weighing kgPerMetre in air
function chainWeightInWater (kgPerMetre, factor = STEEL_IN_SEAWATER) {
  return kgPerMetre * G * factor
}

module.exports = { solve, profile, chainWeightInWater, G, STEEL_IN_SEAWATER }
