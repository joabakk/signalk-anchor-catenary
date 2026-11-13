/*
 * Run with: node test/catenary.test.js
 */
const assert = require('assert')
const { solve, profile, chainWeightInWater } = require('../lib/catenary')
const { rollerToAnchor, move } = require('../lib/geometry')

const tests = []
const test = (name, fn) => tests.push({ name, fn })
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a}`)

// Length of a polyline
const polyLength = pts => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0)

const w = chainWeightInWater(2.2) // 10 mm chain

test('slack: chain hangs straight down and lies on the bottom', () => {
  const r = solve({ span: 10, height: 6, length: 40, weight: w })
  assert.strictEqual(r.state, 'slack')
  close(r.onBottom, 34, 1e-9)
  assert.strictEqual(r.horizontalTension, 0)
  close(r.rollerTension, w * 6, 1e-9)
})

test('catenary: lengths add up and the curve ends at the roller', () => {
  const r = solve({ span: 35, height: 8, length: 40, weight: w })
  assert.strictEqual(r.state, 'catenary')
  close(r.onBottom + r.suspended, 40, 1e-6, 'chain length')
  // touchdown + horizontal extent of the hanging part = span
  close(r.touchdown + r.a * Math.acosh(1 + 8 / r.a), 35, 1e-6, 'span')
  // the hanging part meets the roller
  close(r.a * (Math.cosh((35 - r.x0) / r.a) - 1), 8, 1e-6, 'height')
  assert.strictEqual(r.anchorAngle, 0)
  close(r.rollerTension, r.horizontalTension + w * 8, 1e-6, 'T = H + w h')
  close(polyLength(profile(r, 2000)), 40, 0.01, 'profile length')
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
  const y = x => r.a * (Math.cosh((x - r.x0) / r.a) - Math.cosh(r.x0 / r.a))
  close(y(0), 0, 1e-9)
  close(y(38.65), 10, 1e-6, 'reaches the roller')
  // arc length of the curve between the ends
  close(r.a * (Math.sinh((38.65 - r.x0) / r.a) - Math.sinh(-r.x0 / r.a)), 40, 1e-6, 'length')
  close(polyLength(profile(r, 2000)), 40, 0.01, 'profile length')
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

test('known value: 50 m in 10 m with 45 m span', () => {
  // a from a*acosh(1+h/a) - sqrt(h^2+2ah) + L - X = 0, checked independently
  const r = solve({ span: 45, height: 10, length: 50, weight: 1 })
  const f = a => a * Math.acosh(1 + 10 / a) - Math.sqrt(100 + 20 * a) + 5
  close(f(r.a), 0, 1e-9)
  close(r.horizontalTension, r.a, 1e-12)
})

test('no weight: shape without tensions', () => {
  const r = solve({ span: 35, height: 8, length: 40 })
  assert.strictEqual(r.state, 'catenary')
  assert.strictEqual(r.horizontalTension, undefined)
})

test('invalid input', () => {
  assert.strictEqual(solve({ span: 10, height: 0, length: 40 }), null)
  assert.strictEqual(solve({ span: NaN, height: 5, length: 40 }), null)
})

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
