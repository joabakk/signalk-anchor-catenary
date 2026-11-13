/*
 * Plugin tests against a mock Signal K server. Run with: node test/plugin.test.js
 */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { move } = require('../lib/geometry')

const tests = []
const test = (name, fn) => tests.push({ name, fn })
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a}`)

const ANTENNA = { latitude: 59.9, longitude: 10.7 }

function setup (paths, props) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catenary-'))
  const now = () => new Date().toISOString()
  const data = {}
  const set = (p, v) => { data[p] = { value: v, timestamp: now() } }
  for (const [p, v] of Object.entries(paths)) set(p, v)
  const app = {
    messages: [],
    statuses: [],
    getSelfPath: p => data[p],
    getDataDirPath: () => dir,
    handleMessage (id, delta) { this.messages.push(delta) },
    setPluginStatus (s) { this.statuses.push(s) },
    error (e) { throw new Error(e) },
    debug () {}
  }
  const plugin = require('../index')(app)
  plugin.start(Object.assign({ interval: 3600 }, props))
  return { app, plugin, set, dir, data }
}

const lastValue = (app, p) => {
  for (let i = app.messages.length - 1; i >= 0; i--) {
    for (const u of app.messages[i].updates) {
      const v = (u.values || []).find(x => x.path === p)
      if (v) return v.value
    }
  }
}

test('waits for inputs and says which are missing', () => {
  const { plugin, app } = setup({ 'navigation.position': ANTENNA })
  const s = plugin.compute()
  assert.ok(s.missing.some(m => m.startsWith('anchor position')))
  assert.ok(s.missing.includes('rode length'))
  assert.ok(app.statuses[0].startsWith('Waiting for'))
  plugin.stop()
})

test('depth recorded at drop is tide corrected as the tide falls', () => {
  const t = setup({
    'navigation.position': ANTENNA,
    'navigation.headingTrue': 0,
    'environment.depth.belowSurface': 8,
    'environment.tide.heightNow': 2,
    'navigation.anchor.rodeLength': 40
  }, { rollerForward: 4, rollerHeight: 1.2 })
  // anchor goes down under the bow
  t.set('navigation.anchor.position', move(ANTENNA, 0, 4))
  let s = t.plugin.compute()
  assert.strictEqual(s.depth.source, 'depth at drop, tide corrected')
  close(s.depth.value, 8, 1e-9)
  assert.strictEqual(s.result.state, 'slack')

  // boat falls back 35 m and the tide drops 1.5 m; the sounder now reads a
  // shallower spot under the boat, which must not be used
  t.set('navigation.position', move(ANTENNA, 0, -35))
  t.set('environment.depth.belowSurface', 4)
  t.set('environment.tide.heightNow', 0.5)
  s = t.plugin.compute()
  close(s.depth.value, 6.5, 1e-9, 'depth at the anchor')
  close(s.result.height, 7.7, 1e-9, 'roller above seabed')
  close(s.result.span, 35, 0.01, 'roller to anchor')
  assert.strictEqual(s.result.state, 'catenary')
  close(lastValue(t.app, 'navigation.anchor.catenary.waterDepth'), 6.5, 1e-9)
  t.plugin.stop()

  // the record survives a restart
  const again = require('../index')(t.app)
  again.start({ interval: 3600, rollerForward: 4, rollerHeight: 1.2 })
  close(again.compute().depth.value, 6.5, 1e-9)
  again.stop()
})

test('live depth when there is no tide', () => {
  const t = setup({
    'navigation.position': ANTENNA,
    'environment.depth.belowTransducer': 5,
    'environment.depth.surfaceToTransducer': 0.5,
    'navigation.anchor.rodeLength': 30,
    'navigation.anchor.position': move(ANTENNA, 0, 20)
  })
  const s = t.plugin.compute()
  assert.strictEqual(s.depth.source, 'live depth')
  close(s.depth.value, 5.5, 1e-9)
  t.plugin.stop()
})

test('stale position is ignored', () => {
  const t = setup({ 'navigation.anchor.position': ANTENNA, 'navigation.anchor.rodeLength': 30, 'environment.depth.belowSurface': 5 })
  t.data['navigation.position'] = { value: ANTENNA, timestamp: new Date(Date.now() - 600e3).toISOString() }
  assert.ok(t.plugin.compute().missing.includes('boat position'))
  t.plugin.stop()
})

test('notifies once when the chain lifts the anchor, and clears', () => {
  const t = setup({
    'navigation.position': ANTENNA,
    'navigation.anchor.position': move(ANTENNA, 0, 38.6),
    'environment.depth.belowSurface': 10,
    'navigation.anchor.rodeLength': 40
  })
  const notes = () => t.app.messages.map(m => (m.updates[0].values || []).find(v => v.path === 'notifications.navigation.anchor.catenary')).filter(Boolean)
  assert.strictEqual(t.plugin.compute().result.state, 'lifting')
  assert.strictEqual(notes().filter(n => n.value && n.value.state === 'warn').length, 1)
  t.plugin.compute()
  assert.strictEqual(notes().filter(n => n.value && n.value.state === 'warn').length, 1, 'not repeated')
  t.set('navigation.position', move(ANTENNA, 0, 4))
  assert.strictEqual(t.plugin.compute().result.state, 'catenary')
  assert.strictEqual(notes().pop().value.state, 'normal')
  t.plugin.stop()
})

test('manual rode and charted depth from the webapp routes', async () => {
  const t = setup({
    'navigation.position': ANTENNA,
    'navigation.anchor.position': move(ANTENNA, 0, 25),
    'environment.tide.heightNow': 1
  }, { depthMode: 'manual' })
  const routes = {}
  t.plugin.registerWithRouter({
    use () {},
    get (p, h) { routes['GET ' + p] = h },
    post (p, h) { routes['POST ' + p] = h }
  })
  const call = (key, body) => new Promise(resolve => {
    const res = { code: 200, status (c) { this.code = c; return this }, json (j) { resolve({ code: this.code, body: j }) } }
    routes[key]({ body }, res)
  })
  assert.strictEqual((await call('POST /rode', { length: 'x' })).code, 400)
  await call('POST /rode', { length: 35 })
  const r = await call('POST /seabed', { depth: 6 })
  assert.strictEqual(r.body.inputs.rodeSource, 'manual')
  close(r.body.depth.value, 7, 1e-9, 'charted depth + tide')
  assert.ok(r.body.result)
  t.plugin.stop()
})

function router (t) {
  const routes = {}
  t.plugin.registerWithRouter({
    use () {},
    get (p, h) { routes['GET ' + p] = h },
    post (p, h) { routes['POST ' + p] = h }
  })
  return (key, body) => new Promise(resolve => {
    const res = { code: 200, status (c) { this.code = c; return this }, json (j) { resolve({ code: this.code, body: j }) } }
    routes[key]({ body }, res)
  })
}

test('rode sections from the settings: chain then rope', () => {
  const t = setup({
    'navigation.position': ANTENNA,
    'navigation.headingTrue': 0,
    'environment.depth.belowSurface': 9,
    'navigation.anchor.rodeLength': 60,
    'navigation.anchor.position': move(ANTENNA, 0, 53)
  }, { rollerHeight: 1, rodeSections: [{ material: 'chain', length: 15, weight: 2.2 }, { material: 'nylon', weight: 0.16 }] })
  const s = t.plugin.compute()
  assert.deepStrictEqual(s.rode.map(r => [r.material, r.out]), [['chain', 15], ['nylon', 45]])
  assert.strictEqual(s.result.state, 'catenary')
  assert.ok(s.result.ropeOnBottom > 0, 'rope on the bottom')
  assert.strictEqual(s.sections.length, 2)
  close(lastValue(t.app, 'navigation.anchor.catenary.ropeOnBottom'), s.result.ropeOnBottom, 1e-9)
  t.plugin.stop()
  const chain = setup({
    'navigation.position': ANTENNA,
    'environment.depth.belowSurface': 9,
    'navigation.anchor.rodeLength': 60,
    'navigation.anchor.position': move(ANTENNA, 0, 53)
  }, { rollerHeight: 1 })
  const c = chain.plugin.compute()
  assert.ok(c.result.liftTension > s.result.liftTension, 'all chain takes more pull to lift the anchor')
  chain.plugin.stop()
})

test('snubber: hook on, takes the load with enough slack loop, cleared when hauled in', async () => {
  const t = setup({
    'navigation.position': ANTENNA,
    'navigation.headingTrue': 0,
    'environment.depth.belowSurface': 8,
    'navigation.anchor.rodeLength': 50,
    'navigation.anchor.position': move(ANTENNA, 0, 45)
  }, { rollerForward: 4, rollerHeight: 1.2, snubberLength: 5, snubberAft: 0.5, snubberHeight: 0.4 })
  const call = router(t)
  let s = t.plugin.compute()
  assert.deepStrictEqual(s.snubber, { configured: true, on: false })
  close(s.result.span, 41, 0.01, 'to the roller')

  // hooked on, then 6 m more chain let out: the snubber takes the load
  s = (await call('POST /snubber', { on: true, loop: 6 })).body
  assert.strictEqual(s.snubber.on, true)
  close(s.snubber.hookAt, 44, 1e-9)
  assert.strictEqual(s.snubber.loaded, true)
  close(s.result.span, 41.5, 0.01, 'to the snubber fitting')
  close(s.result.height, 8.4, 1e-9)
  close(s.result.length, 49, 1e-9, '44 m of chain + 5 m snubber')
  assert.strictEqual(s.sections[s.sections.length - 1].kind, 'snubber')
  close(s.snubber.tension, s.result.rollerTension, 1e-9)
  assert.ok(s.snubber.loopPoints.length > 2)
  assert.strictEqual(lastValue(t.app, 'navigation.anchor.catenary.snubberLoaded'), true)
  close(lastValue(t.app, 'navigation.anchor.catenary.rodeLength'), 50, 1e-9, 'rode out is still 50 m')

  // only 1 m of loop: the chain comes tight over the roller first
  s = (await call('POST /snubber', { on: true, loop: 1 })).body
  assert.strictEqual(s.snubber.loaded, false)
  assert.ok(s.snubber.note)
  close(s.result.span, 41, 0.01, 'back to the roller')
  assert.strictEqual(lastValue(t.app, 'navigation.anchor.catenary.snubberLoaded'), false)

  // chain hauled in past the hook: snubber is off
  t.set('navigation.anchor.rodeLength', 40)
  s = t.plugin.compute()
  assert.strictEqual(s.snubber.on, false)

  assert.strictEqual((await call('POST /snubber', { on: true, loop: -1 })).code, 400)
  t.plugin.stop()
})

test('snubber needs a length in the settings, and is cleared when the anchor comes up', async () => {
  const paths = {
    'navigation.position': ANTENNA,
    'environment.depth.belowSurface': 8,
    'navigation.anchor.rodeLength': 40,
    'navigation.anchor.position': move(ANTENNA, 0, 30)
  }
  const none = setup(paths)
  assert.strictEqual((await router(none)('POST /snubber', { on: true })).code, 409)
  none.plugin.stop()

  const rope = setup(paths, { snubberLength: 4, rodeSections: [{ material: 'chain', length: 30 }, { material: 'nylon', weight: 0.16 }] })
  assert.strictEqual((await router(rope)('POST /snubber', { on: true, loop: 2 })).code, 400, 'hook on the rope')
  assert.strictEqual((await router(rope)('POST /snubber', { on: true, loop: 12 })).code, 200, 'hook on the chain')
  rope.plugin.stop()

  const t = setup(paths, { snubberLength: 4 })
  assert.strictEqual((await router(t)('POST /snubber', { on: true, loop: 3 })).body.snubber.on, true)
  t.set('navigation.anchor.position', null)
  assert.strictEqual(t.plugin.compute().snubber.on, false)
  t.plugin.stop()
})

;(async () => {
  let failed = 0
  for (const t of tests) {
    try { await t.fn(); console.log('ok   ', t.name) } catch (e) { failed++; console.log('FAIL ', t.name, '\n     ', e.stack) }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  process.exit(failed ? 1 : 0)
})()
