/*
 * Static shape of an anchor rode between the anchor (on the seabed) and the boat.
 *
 * Coordinates are in a vertical plane through the anchor and the point where the
 * rode is made fast on the boat (the bow roller, or the snubber fitting):
 * x runs horizontally from the anchor (x = 0) towards the boat (x = span),
 * y is height above the seabed (the anchor is at y = 0, the boat end at y = height).
 * The seabed is taken as flat between the two.
 *
 * The rode is a list of sections from the anchor end, each with its own length
 * and weight per metre in water: chain, then perhaps a rope, or chains of
 * different sizes, and a snubber at the boat end. Each section hangs in its own
 * catenary; the horizontal tension H is the same all along, and the vertical
 * force grows by the weight of each piece of rode that hangs. A light rope
 * hangs almost straight. Rope that floats is not modelled: it would lie on the
 * surface, not hang.
 *
 * Given the horizontal span, the height and the rode, the shape is fully
 * determined. Four cases:
 *
 *   slack     the rode is long enough to hang straight down from the boat and
 *             still lie on the bottom all the way to the anchor: no horizontal pull.
 *   catenary  part of the rode lies on the bottom, the rest hangs and touches down
 *             tangentially. The anchor gets a horizontal pull.
 *   lifting   all the rode is off the bottom; it pulls the anchor shank upwards
 *             (anchorAngle > 0). Holding power drops fast.
 *   taut      the rode is shorter than the straight line from the boat to the anchor.
 *             Physically impossible, so the inputs disagree (anchor position,
 *             rode length or depth is off). Drawn as a straight line.
 *
 * The solver works with V0, the vertical force at the anchor end. Where
 * V0 + (weight of the rode from the anchor up to s) is negative, the rode lies on
 * the bottom; from where it turns positive, it hangs. V0 > 0 means the anchor is
 * being lifted. For a given H, V0 is set by the height of the boat end; H is then
 * set by the span.
 */

const G = 9.80665
const SEAWATER = 1025 // kg/m3

// Densities in kg/m3. Weight in water / weight in air = 1 - 1025 / density.
const MATERIALS = {
  chain: { label: 'Chain', kind: 'chain', density: 7850 },
  nylon: { label: 'Nylon rope', kind: 'rope', density: 1140 },
  polyester: { label: 'Polyester rope', kind: 'rope', density: 1380 }
}
const STEEL_IN_SEAWATER = 1 - SEAWATER / MATERIALS.chain.density

// Weight in water, N/m, of a rode weighing kgPerMetre in air
function weightInWater (kgPerMetre, material = 'chain') {
  const m = MATERIALS[material] || MATERIALS.chain
  if (!Number.isFinite(kgPerMetre) || kgPerMetre <= 0) return 0
  return Math.max(0, kgPerMetre * G * (1 - SEAWATER / m.density))
}

// Weight in water, N/m, of a chain weighing kgPerMetre in air
function chainWeightInWater (kgPerMetre, factor = STEEL_IN_SEAWATER) {
  return kgPerMetre * G * factor
}

/*
 * Cut a rode made of sections (from the anchor end) to the length that is out.
 * The last section runs to the boat whatever its length; sections beyond what is
 * out are left off. Returns copies with `length` set to the length out.
 */
function layout (sections, out) {
  const res = []
  let left = out
  sections.forEach((s, i) => {
    if (!(left > 1e-12)) return
    const last = i === sections.length - 1
    const full = Number.isFinite(s.length) && s.length > 0 ? s.length : 0
    const len = last ? left : Math.min(left, full)
    if (len <= 0) return
    res.push(Object.assign({}, s, { length: len }))
    left -= len
  })
  return res
}

// ---------------------------------------------------------------- solver

/*
 * Horizontal and vertical extent of a hanging piece of rode of length t and
 * weight w per metre, under horizontal tension H, with vertical force Va >= 0 at
 * its lower end. Written so it stays accurate as w goes to 0 (straight line).
 */
function piece (H, Va, w, t) {
  const ha = Math.hypot(H, Va)
  if (!(w * t > 1e-13 * ha)) return { dx: t * H / ha, dy: t * Va / ha }
  const Vb = Va + w * t
  const hb = Math.hypot(H, Vb)
  // asinh(Vb/H) - asinh(Va/H) = asinh(w t (Va + Vb) / (Vb ha + Va hb))
  return {
    dx: H / w * Math.asinh(w * t * (Va + Vb) / (Vb * ha + Va * hb)),
    dy: (Va + Vb) * t / (ha + hb)
  }
}

// Follow the rode from the anchor. visit(i, lying, hangStart, hangLength) is called per section.
function walk (segs, H, V0, visit) {
  let x = 0
  let y = 0
  let V = V0
  segs.forEach((seg, i) => {
    let rest = seg.length
    const w = seg.w
    let lying = 0
    if (V < 0) {
      lying = w > 0 ? Math.min(rest, -V / w) : rest
      x += lying
      V += w * lying
      rest -= lying
    }
    const start = { x, y, V: Math.max(0, V) }
    if (rest > 0) {
      V = Math.max(0, V)
      const p = piece(H, V, w, rest)
      x += p.dx
      y += p.dy
      V += w * rest
    }
    if (visit) visit(i, lying, start, rest)
  })
  return { x, y, V }
}

// Vertical force at the anchor that brings the boat end to height h, for a given H
function anchorForce (segs, H, h, W) {
  let lo = -W
  let hi = Math.max(W, H, 1e-9)
  for (let i = 0; walk(segs, H, hi).y <= h; i++) {
    if (i > 200) return undefined
    hi *= 2
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (walk(segs, H, mid).y > h) hi = mid
    else lo = mid
    if (hi - lo <= 1e-15 * (Math.abs(lo) + Math.abs(hi))) break
  }
  return (lo + hi) / 2
}

// Bisect f(v) = 0 in log space for v > 0, f increasing, f(lo) < 0 < f(hi)
function bisectLog (f, lo, hi) {
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi)
    if (f(mid) > 0) hi = mid
    else lo = mid
    if (hi / lo - 1 < 1e-13) break
  }
  return Math.sqrt(lo * hi)
}

/*
 * solve({ span, height, sections })  or  solve({ span, height, length, weight })
 *   span      horizontal distance anchor -> boat end, m
 *   height    boat end above the seabed, m (water depth at the anchor + height above water)
 *   sections  [{ length, weight, kind, material, label }] from the anchor end; weight
 *             in water, N/m. length is what is out of that section.
 *   length, weight  a uniform rode (chain): length out, m, and weight in water, N/m
 * Weights are optional: without them the shape is that of a uniform rode and
 * tensions are undefined.
 */
function solve ({ span, height, length, weight, sections }) {
  const X = span
  const h = height
  if (!sections) sections = [{ length, weight, kind: 'chain' }]
  if (!Array.isArray(sections) || sections.length === 0) return null
  if (sections.some(s => !Number.isFinite(s.length) || s.length < 0)) return null
  const L = sections.reduce((a, s) => a + s.length, 0)
  if (![X, h, L].every(Number.isFinite) || X < 0 || h <= 0 || L <= 0) return null

  const hasWeight = sections.some(s => Number.isFinite(s.weight) && s.weight > 0)
  // Every section gets at least a tiny weight: a weightless rode has no hanging shape
  const wMax = hasWeight ? Math.max(...sections.map(s => (Number.isFinite(s.weight) ? s.weight : 0))) : 1
  const segs = sections.map(s => ({ length: s.length, w: Math.max(hasWeight && Number.isFinite(s.weight) ? s.weight : (hasWeight ? 0 : 1), wMax * 1e-4) }))
  const W = segs.reduce((a, s) => a + s.w * s.length, 0)
  const N = v => (hasWeight && Number.isFinite(v) ? v : undefined)

  const chord = Math.hypot(X, h)
  const maxSpan = L > h ? Math.sqrt(L * L - h * h) : 0 // bar tight

  // Anchor starts to lift when the touchdown point reaches the anchor: V0 = 0.
  // The height reached with V0 = 0 falls as H grows.
  let liftSpan = 0
  let liftH
  if (L > h && walk(segs, W * 1e-12, 0).y > h) {
    let hi = W
    while (walk(segs, hi, 0).y >= h) hi *= 2
    liftH = bisectLog(H => h - walk(segs, H, 0).y, W * 1e-12, hi)
    liftSpan = walk(segs, liftH, 0).x
  }

  const common = {
    span: X,
    height: h,
    length: L,
    chord,
    scope: L / h,
    liftSpan, // horizontal distance at which the anchor starts to lift
    maxSpan,
    liftTension: N(liftH) // horizontal pull at which the anchor starts to lift
  }

  let state, H, V0
  if (L < chord * (1 - 1e-9) || L <= h) state = 'taut'
  else if (L >= X + h) state = 'slack'
  else {
    const xEnd = H => walk(segs, H, anchorForce(segs, H, h, W)).x
    let hi = W
    for (let i = 0; xEnd(hi) <= X && i < 400; i++) hi *= 2
    H = bisectLog(H => xEnd(H) - X, W * 1e-12, hi)
    V0 = anchorForce(segs, H, h, W)
    state = V0 > 0 ? 'lifting' : 'catenary'
  }

  // Per section: how much lies on the bottom
  const out = sections.map(s => ({ kind: s.kind || 'chain', material: s.material, label: s.label, length: s.length, start: 0, onBottom: 0 }))
  let s0 = 0
  for (const o of out) { o.start = s0; s0 += o.length }

  let res
  if (state === 'taut') {
    const angle = Math.atan2(h, X)
    res = { state, touchdown: 0, onBottom: 0, suspended: L, anchorAngle: angle, rollerAngle: angle }
  } else if (state === 'slack') {
    // Lies along the bottom up to L - h from the anchor, then hangs straight down
    const lie = L - h
    for (const o of out) o.onBottom = Math.max(0, Math.min(o.length, lie - o.start))
    let Vtop = 0 // weight of the part hanging straight down
    segs.forEach((sg, i) => { Vtop += sg.w * (out[i].length - out[i].onBottom) })
    res = {
      state,
      touchdown: X,
      onBottom: lie,
      suspended: h,
      anchorAngle: 0,
      rollerAngle: Math.PI / 2,
      horizontalTension: N(0),
      rollerTension: N(Vtop),
      anchorTension: N(0)
    }
  } else {
    let onBottom = 0
    const end = walk(segs, H, V0, (i, lying) => { out[i].onBottom = lying; onBottom += lying })
    res = {
      state,
      touchdown: onBottom, // the lying part runs straight from the anchor
      onBottom,
      suspended: L - onBottom,
      anchorAngle: V0 > 0 ? Math.atan2(V0, H) : 0,
      rollerAngle: Math.atan2(end.V, H),
      horizontalTension: N(H),
      rollerTension: N(Math.hypot(H, end.V)),
      anchorTension: N(Math.hypot(H, Math.max(0, V0)))
    }
  }
  res.sections = out
  res.ropeOnBottom = out.filter(o => o.kind === 'rope').reduce((a, o) => a + o.onBottom, 0)
  const r = Object.assign(common, res)
  // kept for drawing, not serialised
  Object.defineProperty(r, 'solution', { value: { segs, H, V0 }, enumerable: false })
  return r
}

// ---------------------------------------------------------------- drawing

/*
 * Points along each section, from the anchor to the boat end:
 * [{ kind, material, label, length, onBottom, bottom: [[x, y], ...], hanging: [[x, y], ...] }]
 * For a slack rode the part lying on the bottom is stopped at the foot of the
 * boat end (where it really lies is unknown).
 */
function profileSections (r, n = 60) {
  if (!r) return []
  const X = r.span
  const h = r.height
  const L = r.length
  const res = r.sections.map(o => ({ kind: o.kind, material: o.material, label: o.label, length: o.length, onBottom: o.onBottom, bottom: [], hanging: [] }))
  const steps = len => Math.max(2, Math.ceil(n * len / L))

  if (r.state === 'taut' || r.state === 'slack') {
    r.sections.forEach((o, i) => {
      const lie = o.onBottom
      if (lie > 0) res[i].bottom = [[Math.min(o.start, X), 0], [Math.min(o.start + lie, X), 0]]
      const hang = o.length - lie
      if (hang > 0) {
        const k = steps(hang)
        for (let j = 0; j <= k; j++) {
          const s = o.start + lie + hang * j / k
          res[i].hanging.push(r.state === 'taut' ? [X * s / L, h * s / L] : [X, s - (L - h)])
        }
      }
    })
    return res
  }

  const { segs, H, V0 } = r.solution
  walk(segs, H, V0, (i, lying, start, hang) => {
    if (lying > 0) res[i].bottom = [[start.x - lying, 0], [start.x, 0]]
    if (hang > 0) {
      const k = steps(hang)
      for (let j = 0; j <= k; j++) {
        const p = piece(H, start.V, segs[i].w, hang * j / k)
        res[i].hanging.push([start.x + p.dx, Math.max(0, start.y + p.dy)])
      }
    }
  })
  // land exactly on the boat end
  for (let i = res.length - 1; i >= 0; i--) {
    if (res[i].hanging.length) { res[i].hanging[res[i].hanging.length - 1] = [X, h]; break }
  }
  return res
}

// All points [x, y] along the rode from the anchor to the boat end, for drawing.
function profile (r, n = 60) {
  const pts = []
  for (const s of profileSections(r, n)) {
    for (const p of s.bottom.concat(s.hanging)) {
      const q = pts[pts.length - 1]
      if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) pts.push(p)
    }
  }
  return pts
}

/*
 * A rode of length len hanging freely between two points, such as the slack
 * loop of chain between a snubber hook and the roller. Clipped at the seabed
 * (y = 0). For drawing only.
 */
function hangBetween (p1, p2, len, n = 40) {
  const [x1, y1] = p1
  const [x2, y2] = p2
  const dx = x2 - x1
  const dy = y2 - y1
  const chord = Math.hypot(dx, dy)
  if (!(len > chord * (1 + 1e-9))) return [p1, p2]
  if (Math.abs(dx) < 1e-3 * len) {
    const low = Math.max(0, (y1 + y2 - len) / 2)
    return [p1, [(x1 + x2) / 2, low], p2]
  }
  // sqrt(len^2 - dy^2) = 2a sinh(|dx| / 2a)
  const k = Math.sqrt(len * len - dy * dy)
  const ax = Math.abs(dx)
  const g = a => 2 * a * Math.sinh(ax / (2 * a)) - k // decreasing in a
  let lo = ax * 1e-6
  while (!Number.isFinite(g(lo))) lo *= 2
  let hi = Math.max(ax, len)
  while (g(hi) > 0) hi *= 2
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi)
    if (g(mid) > 0) lo = mid
    else hi = mid
  }
  const a = Math.sqrt(lo * hi)
  const sign = Math.sign(dx)
  // lowest point, measured along |dx| from the first point
  const u0 = ax / 2 - a * Math.atanh(dy / len)
  const c = y1 - a * Math.cosh(u0 / a)
  const pts = []
  for (let j = 0; j <= n; j++) {
    const u = ax * j / n
    pts.push([x1 + sign * u, Math.max(0, c + a * Math.cosh((u - u0) / a))])
  }
  pts[pts.length - 1] = p2
  return pts
}

module.exports = { solve, profile, profileSections, hangBetween, layout, weightInWater, chainWeightInWater, MATERIALS, G, STEEL_IN_SEAWATER }
