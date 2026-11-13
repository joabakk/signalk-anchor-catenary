/*
 * Run with: node test/catenary.test.js
 */
const assert = require('assert')
const { solve, profile, profileSections, hangBetween, layout, weightInWater, chainWeightInWater } = require('../lib/catenary')
const { rollerToAnchor, move } = require('../lib/geometry')

const tests = []
const test = (name, fn) => tests.push({ name, fn })
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a}`)

// Length of a polyline
const polyLength = pts => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0)

const w = chainWeightInWater(2.2) // 10 mm chain

/*
 * Closed-form solution for a uniform chain, as an independent reference.
 * Catenary y = a (cosh((x - x0) / a) - 1), a = H / w.
 */
function reference (X, h, L, w) {
  const bisect = (f, lo, hi) => {
    for (let i = 0; i < 300; i++) { const m = Math.sqrt(lo * hi); if (f(m) > 0) hi = m; else lo = m }
    return Math.sqrt(lo * hi)
  }
  const aLift = (L * L - h * h) / (2 * h)
  const liftSpan = aLift * Math.acosh(1 + h / aLift)
  if (X <= liftSpan) {
    const a = bisect(a => a * Math.acosh(1 + h / a) - Math.sqrt(h * h + 2 * a * h) + L - X, h * 1e-12, aLift)
    return { state: 'catenary', H: w * a, onBottom: L - Math.sqrt(h * h + 2 * a * h), T: w * (a + h), anchorAngle: 0, liftSpan, liftTension: w * aLift }
  }
  const k = Math.sqrt(L * L - h * h)
  let hi = Math.max(aLift, X, 1)
  while (k - 2 * hi * Math.sinh(X / (2 * hi)) <= 0) hi *= 2
  const a = bisect(a => k - 2 * a * Math.sinh(X / (2 * a)), X * 1e-9, hi)
  const x0 = X / 2 - a * Math.atanh(h / L)
  return { state: 'lifting', H: w * a, onBottom: 0, T: w * a * Math.cosh((X - x0) / a), anchorAngle: Math.atan(Math.sinh(-x0 / a)), liftSpan, liftTension: w * aLift }
}

// ------------------------------------------------------------- one chain

test('slack: chain hangs straight down and lies on the bottom', () => {
  const r = solve({ span: 10, height: 6, length: 40, weight: w })
  assert.strictEqual(r.state, 'slack')
  close(r.onBottom, 34, 1e-9)
  assert.strictEqual(r.horizontalTension, 0)
  close(r.rollerTension, w * 6, 1e-9)
})

test('one chain agrees with the closed-form catenary', () => {
  const cases = [[35, 8, 40], [33, 8, 40], [31, 10, 40], [45, 10, 50], [38.65, 10, 40], [28, 3, 30], [66, 12, 75], [72.5, 12, 75]]
  for (const [X, h, L] of cases) {
    const r = solve({ span: X, height: h, length: L, weight: w })
    const e = reference(X, h, L, w)
    const msg = `${X}/${h}/${L}`
    assert.strictEqual(r.state, e.state, msg)
    close(r.horizontalTension, e.H, e.H * 1e-7, msg + ' H')
    close(r.onBottom, e.onBottom, 1e-6, msg + ' on bottom')
    close(r.rollerTension, e.T, e.T * 1e-7, msg + ' T')
    close(r.anchorAngle, e.anchorAngle, 1e-7, msg + ' anchor angle')
    close(r.liftSpan, e.liftSpan, 1e-6, msg + ' lift span')
    close(r.liftTension, e.liftTension, e.liftTension * 1e-7, msg + ' lift tension')
  }
})

test('catenary: lengths add up and the curve ends at the roller', () => {
  const r = solve({ span: 35, height: 8, length: 40, weight: w })
  assert.strictEqual(r.state, 'catenary')
  close(r.onBottom + r.suspended, 40, 1e-9, 'chain length')
  assert.strictEqual(r.anchorAngle, 0)
  close(r.rollerTension, r.horizontalTension + w * 8, 1e-6, 'T = H + w h')
  const pts = profile(r, 2000)
  close(polyLength(pts), 40, 0.01, 'profile length')
  assert.deepStrictEqual(pts[0], [0, 0])
  assert.deepStrictEqual(pts[pts.length - 1], [35, 8])
  close(pts[1][0], r.touchdown, 1e-9, 'touchdown')
})

test('more pull pulls more chain off the bottom', () => {
  const near = solve({ span: 33, height: 8, length: 40, weight: w })
  const far = solve({ span: 36, height: 8, length: 40, weight: w })
  assert.ok(far.onBottom < near.onBottom)
  assert.ok(far.horizontalTension > near.horizontalTension)
})

test('lift point: at liftSpan the touchdown reaches the anchor', () => {
  const r0 = solve({ span: 30, height: 10, length: 40, weight: w })
  const r = solve({ span: r0.liftSpan * (1 - 1e-9), height: 10, length: 40, weight: w })
  assert.strictEqual(r.state, 'catenary')
  close(r.onBottom, 0, 1e-3)
  close(r.horizontalTension, r0.liftTension, r0.liftTension * 1e-3)
})

test('lifting: chain fully off the bottom, shank pulled up', () => {
  const r = solve({ span: 38.65, height: 10, length: 40, weight: w })
  assert.strictEqual(r.state, 'lifting')
  assert.ok(r.anchorAngle > 0)
  assert.strictEqual(r.onBottom, 0)
  const pts = profile(r, 2000)
  close(polyLength(pts), 40, 0.01, 'profile length')
  close(pts[1][1] / pts[1][0], Math.tan(r.anchorAngle), 1e-2, 'leaves the anchor at the anchor angle')
})

test('continuous across the lift point', () => {
  const before = solve({ span: 30, height: 10, length: 40, weight: w })
  const a = solve({ span: before.liftSpan - 1e-6, height: 10, length: 40, weight: w })
  const b = solve({ span: before.liftSpan + 1e-6, height: 10, length: 40, weight: w })
  assert.strictEqual(a.state, 'catenary')
  assert.strictEqual(b.state, 'lifting')
  close(a.horizontalTension, b.horizontalTension, a.horizontalTension * 1e-3)
  close(b.anchorAngle, 0, 1e-3)
})

test('taut: rode shorter than the straight line', () => {
  const r = solve({ span: 45, height: 10, length: 40, weight: w })
  assert.strictEqual(r.state, 'taut')
  assert.strictEqual(r.horizontalTension, undefined)
})

test('no weight: shape without tensions', () => {
  const r = solve({ span: 35, height: 8, length: 40 })
  assert.strictEqual(r.state, 'catenary')
  assert.strictEqual(r.horizontalTension, undefined)
  close(r.onBottom, solve({ span: 35, height: 8, length: 40, weight: w }).onBottom, 1e-6, 'same shape as with weight')
})

test('invalid input', () => {
  assert.strictEqual(solve({ span: 10, height: 0, length: 40 }), null)
  assert.strictEqual(solve({ span: NaN, height: 5, length: 40 }), null)
  assert.strictEqual(solve({ span: 10, height: 5, sections: [] }), null)
})

// -------------------------------------------------------------- sections

test('a chain cut into sections of the same weight solves the same', () => {
  const one = solve({ span: 36, height: 8, length: 40, weight: w })
  const three = solve({ span: 36, height: 8, sections: [{ length: 10, weight: w }, { length: 25, weight: w }, { length: 5, weight: w }] })
  close(three.horizontalTension, one.horizontalTension, one.horizontalTension * 1e-7)
  close(three.onBottom, one.onBottom, 1e-6)
  close(three.sections.reduce((a, s) => a + s.onBottom, 0), three.onBottom, 1e-9, 'per-section sum')
  close(three.sections[0].onBottom, 10, 1e-9, 'first section all on the bottom')
})

test('heavy chain at the anchor, light chain above', () => {
  const heavy = chainWeightInWater(3.8)
  const light = chainWeightInWater(1.4)
  const r = solve({ span: 42, height: 10, sections: [{ length: 20, weight: heavy }, { length: 30, weight: light }] })
  assert.strictEqual(r.state, 'catenary')
  close(polyLength(profile(r, 4000)), 50, 0.01, 'profile length')
  // vertical force at the roller = weight of what hangs
  const hangingWeight = heavy * (20 - r.sections[0].onBottom) + light * (30 - r.sections[1].onBottom)
  close(Math.sqrt(r.rollerTension ** 2 - r.horizontalTension ** 2), hangingWeight, hangingWeight * 1e-6, 'V at roller')
  // tension rises by w * dy in each section: T_roller - H = sum w_i * (height gained in section i)
  const ps = profileSections(r, 4000)
  const top0 = ps[0].hanging.length ? ps[0].hanging[ps[0].hanging.length - 1][1] : 0
  close(r.rollerTension - r.horizontalTension, heavy * top0 + light * (10 - top0), 1e-3, 'T = H + sum w dy')
  // all heavy chain holds the anchor down longer than all light chain
  const allLight = solve({ span: 42, height: 10, length: 50, weight: light })
  const allHeavy = solve({ span: 42, height: 10, length: 50, weight: heavy })
  assert.ok(r.liftTension > allLight.liftTension && r.liftTension < allHeavy.liftTension)
})

test('chain and rope: the rope runs nearly straight, rope on the bottom is reported', () => {
  const rope = weightInWater(0.16, 'nylon')
  close(rope, 0.16 * 9.80665 * (1 - 1025 / 1140), 1e-12)
  const sections = [{ length: 15, weight: w, kind: 'chain' }, { length: 45, weight: rope, kind: 'rope' }]
  const r = solve({ span: 58.9, height: 10, sections })
  assert.strictEqual(r.state, 'catenary')
  assert.strictEqual(r.ropeOnBottom, 0)
  assert.ok(r.sections[0].onBottom > 0, 'chain on the bottom')
  close(polyLength(profile(r, 4000)), 60, 0.01, 'profile length')
  // a little closer, and the light rope comes to lie on the bottom
  const r2 = solve({ span: 53, height: 10, sections })
  assert.strictEqual(r2.state, 'catenary')
  assert.ok(r2.ropeOnBottom > 0, 'rope on the bottom')
  close(r2.sections[0].onBottom, 15, 1e-9, 'all chain on the bottom')
  // chain + rope lifts the anchor at a smaller pull than all chain
  const chain = solve({ span: 58.9, height: 10, length: 60, weight: w })
  assert.ok(r.liftTension < chain.liftTension)
})

test('a rope with no weight given hangs as a light rope', () => {
  const r = solve({ span: 33, height: 8, sections: [{ length: 10, weight: w }, { length: 25, kind: 'rope' }] })
  assert.ok(r && r.state === 'catenary')
  close(polyLength(profile(r, 4000)), 35, 0.01, 'profile length')
  const pts = profileSections(r, 4000)[1].hanging
  assert.deepStrictEqual(pts[pts.length - 1], [33, 8])
})

test('layout: cut the rode to what is out', () => {
  const rode = [{ material: 'chain', length: 30 }, { material: 'nylon', length: 50 }]
  assert.deepStrictEqual(layout(rode, 20).map(s => s.length), [20])
  assert.deepStrictEqual(layout(rode, 45).map(s => s.length), [30, 15])
  assert.deepStrictEqual(layout(rode, 95).map(s => s.length), [30, 65], 'the last section runs to the boat')
  assert.deepStrictEqual(layout([{ material: 'chain' }], 40).map(s => s.length), [40])
})

test('hanging loop between two points has the given length', () => {
  const pts = hangBetween([10, 5], [12, 8], 6, 2000)
  close(polyLength(pts), 6, 0.01)
  assert.deepStrictEqual(pts[pts.length - 1], [12, 8])
  close(polyLength(hangBetween([12, 8], [10, 5], 6, 2000)), 6, 0.01, 'either way round')
})

// -------------------------------------------------------------- geometry

test('roller ahead of the antenna, anchor dead ahead', () => {
  const antenna = { latitude: 59.9, longitude: 10.7 }
  const anchor = move(antenna, 0, 40) // 40 m north
  const g = rollerToAnchor({ antenna, heading: 0, forward: 5, anchor })
  close(g.distance, 35, 0.01)
  close(g.relativeBearing, 0, 1e-6)
  const g2 = rollerToAnchor({ antenna, heading: Math.PI / 2, forward: 5, anchor }) // heading east
  assert.ok(g2.relativeBearing < 0, 'anchor to port when heading east with anchor north')
})

let failed = 0
for (const t of tests) {
  try { t.fn(); console.log('ok   ', t.name) } catch (e) { failed++; console.log('FAIL ', t.name, '\n     ', e.message) }
}
console.log(`${tests.length - failed}/${tests.length} passed`)
process.exit(failed ? 1 : 0)
