/*
 * Signal K plugin: live anchor chain catenary.
 *
 * Licensed under the Apache License, Version 2.0
 */

const fs = require('fs')
const path = require('path')
const { solve, profile, chainWeightInWater } = require('./lib/catenary')
const { rollerToAnchor, offset } = require('./lib/geometry')

const OUT = 'navigation.anchor.catenary'
const NOTIFICATION = 'notifications.navigation.anchor.catenary'

module.exports = function (app) {
  const plugin = {
    id: 'signalk-anchor-catenary',
    name: 'Anchor catenary',
    description: 'Live shape, tension and lift-off of the anchor chain from anchor and boat positions, depth and tide'
  }

  let options = {}
  let timer
  let store = {} // persisted: drop record and manual values
  let last = null // last computed state, served to the webapp
  let lastNotification = null
  let lastStatus

  plugin.schema = {
    type: 'object',
    properties: {
      rollerForward: { type: 'number', title: 'Bow roller distance forward of the GPS antenna (m)', description: 'Leave empty to use sensors.gps.fromBow', default: null },
      rollerStarboard: { type: 'number', title: 'Bow roller distance to starboard of the GPS antenna (m)', description: 'Negative for port', default: 0 },
      rollerHeight: { type: 'number', title: 'Bow roller height above the waterline (m)', description: 'Leave empty to use design.bowAnchorRollerHeight', default: null },
      chainWeight: { type: 'number', title: 'Chain weight in air (kg/m)', description: 'e.g. 8 mm: 1.4, 10 mm: 2.2, 12 mm: 3.2, 13 mm: 3.8', default: 2.2 },
      depthPath: { type: 'string', title: 'Depth path', description: 'Water depth under the boat. environment.depth.belowSurface is used if empty, else belowTransducer + surfaceToTransducer', default: 'environment.depth.belowSurface' },
      depthOffset: { type: 'number', title: 'Added to the depth path (m)', description: 'e.g. the transducer depth if the depth path is belowTransducer', default: 0 },
      depthMode: {
        type: 'string',
        title: 'Water depth at the anchor',
        enum: ['auto', 'drop', 'live', 'manual'],
        enumNames: [
          'Auto: depth recorded when the anchor was dropped, tide corrected; live depth if there is no tide',
          'Depth recorded when the anchor was dropped, tide corrected',
          'Live depth under the boat',
          'Charted depth entered in the webapp, plus tide'
        ],
        default: 'auto'
      },
      tidePath: { type: 'string', title: 'Tide height path', description: 'Height of the tide above chart datum, e.g. from signalk-tides-api or signalk-tides', default: 'environment.tide.heightNow' },
      rodePath: { type: 'string', title: 'Rode length path', description: 'Chain out, from a chain counter. If there is none, enter the length in the webapp', default: 'navigation.anchor.rodeLength' },
      maxAge: { type: 'number', title: 'Ignore position, heading and depth older than (s)', default: 60 },
      interval: { type: 'number', title: 'Update interval (s)', default: 2 },
      notify: { type: 'boolean', title: 'Notify when the chain lifts the anchor or the inputs disagree', default: true }
    }
  }

  // ---------------------------------------------------------------- inputs

  function node (p) {
    if (!p) return undefined
    const n = app.getSelfPath(p)
    if (n && typeof n === 'object' && 'value' in n) return n
    return n === undefined ? undefined : { value: n }
  }

  // Value of a path, or undefined if missing or older than maxAge seconds
  function read (p, maxAge) {
    const n = node(p)
    if (!n || n.value === undefined || n.value === null) return undefined
    if (maxAge && n.timestamp) {
      const age = (Date.now() - new Date(n.timestamp).getTime()) / 1000
      if (age > maxAge) return undefined
    }
    return n.value
  }

  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const isPos = p => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)

  function liveDepth () {
    const maxAge = options.maxAge
    const p = options.depthPath || 'environment.depth.belowSurface'
    let d = num(read(p, maxAge))
    if (d !== undefined) return d + (options.depthOffset || 0)
    if (p === 'environment.depth.belowSurface') {
      d = num(read('environment.depth.belowTransducer', maxAge))
      const t = num(read('environment.depth.surfaceToTransducer'))
      if (d !== undefined) return d + (t !== undefined ? t : (options.depthOffset || 0))
    }
    return undefined
  }

  function heading () {
    const maxAge = options.maxAge
    const t = num(read('navigation.headingTrue', maxAge))
    if (t !== undefined) return t
    const m = num(read('navigation.headingMagnetic', maxAge))
    if (m === undefined) return undefined
    return m + (num(read('navigation.magneticVariation')) || 0)
  }

  function gather () {
    const forward = num(options.rollerForward) !== undefined ? options.rollerForward : num(read('sensors.gps.fromBow'))
    const rollerHeight = num(options.rollerHeight) !== undefined ? options.rollerHeight : num(read('design.bowAnchorRollerHeight'))
    const sensorRode = num(read(options.rodePath))
    const length = read('design.length')
    return {
      boatLength: num(length && typeof length === 'object' ? length.overall : length),
      boatBeam: num(read('design.beam')),
      anchor: read('navigation.anchor.position'),
      antenna: read('navigation.position', options.maxAge),
      heading: heading(),
      depth: liveDepth(),
      tide: num(read(options.tidePath)),
      rode: sensorRode !== undefined ? sensorRode : num(store.manualRode),
      rodeSource: sensorRode !== undefined ? 'sensor' : (num(store.manualRode) !== undefined ? 'manual' : undefined),
      rollerForward: forward || 0,
      rollerForwardSource: num(options.rollerForward) !== undefined ? 'setting' : (forward !== undefined ? 'sensors.gps.fromBow' : 'none'),
      rollerStarboard: options.rollerStarboard || 0,
      rollerHeight: rollerHeight || 0,
      rollerHeightSource: num(options.rollerHeight) !== undefined ? 'setting' : (rollerHeight !== undefined ? 'design.bowAnchorRollerHeight' : 'none')
    }
  }

  // ------------------------------------------------- depth at the anchor

  // Remember the depth and tide when the anchor goes down, so the depth at the
  // anchor can be followed through the tide even when the boat swings away.
  function updateRecord (inputs) {
    const a = node('navigation.anchor.position')
    if (a && a.value === null && store.record) {
      store.record = undefined // anchor up
      save()
      return
    }
    if (!isPos(inputs.anchor)) return
    const r = store.record
    const moved = r && isPos(r.anchor) ? Math.hypot(...Object.values(offset(r.anchor, inputs.anchor))) : Infinity
    if (moved > 2) {
      store.record = { anchor: inputs.anchor, time: new Date().toISOString(), depth: inputs.depth, tide: inputs.tide }
      save()
    } else if (r.depth === undefined && inputs.depth !== undefined) {
      Object.assign(r, { depth: inputs.depth, tide: inputs.tide, time: new Date().toISOString() })
      save()
    }
  }

  function anchorDepth (inputs) {
    const mode = options.depthMode || 'auto'
    const r = store.record
    const tide = inputs.tide
    if (mode === 'manual') {
      if (num(store.manualDatumDepth) === undefined) return { source: 'manual (not set)' }
      return { value: store.manualDatumDepth + (tide || 0), source: tide !== undefined ? 'charted depth + tide' : 'charted depth (no tide)', tideCorrected: tide !== undefined }
    }
    const haveDrop = r && num(r.depth) !== undefined
    const tideCorrectable = haveDrop && num(r.tide) !== undefined && tide !== undefined
    if (mode === 'drop' || (mode === 'auto' && tideCorrectable)) {
      if (!haveDrop) return { source: 'depth at drop (not recorded)' }
      if (tideCorrectable) return { value: r.depth - r.tide + tide, source: 'depth at drop, tide corrected', tideCorrected: true, tideChange: tide - r.tide }
      return { value: r.depth, source: 'depth at drop (no tide)', tideCorrected: false }
    }
    if (inputs.depth === undefined) return { source: 'live depth (none)' }
    return { value: inputs.depth, source: 'live depth', tideCorrected: false }
  }

  // ------------------------------------------------------------- compute

  function compute () {
    const inputs = gather()
    updateRecord(inputs)
    const depth = anchorDepth(inputs)
    const missing = []
    if (!isPos(inputs.anchor)) missing.push('anchor position (navigation.anchor.position)')
    if (!isPos(inputs.antenna)) missing.push('boat position')
    const needHeading = inputs.rollerForward !== 0 || inputs.rollerStarboard !== 0
    if (needHeading && inputs.heading === undefined) missing.push('heading')
    if (depth.value === undefined) missing.push('depth (' + depth.source + ')')
    if (inputs.rode === undefined) missing.push('rode length')

    const state = { time: new Date().toISOString(), inputs, depth, record: store.record, manual: { rode: store.manualRode, datumDepth: store.manualDatumDepth }, settings: publicSettings(), missing }
    if (missing.length === 0) {
      const geo = rollerToAnchor({
        antenna: inputs.antenna,
        heading: inputs.heading || 0,
        forward: inputs.rollerForward,
        starboard: inputs.rollerStarboard,
        anchor: inputs.anchor
      })
      const height = depth.value + inputs.rollerHeight
      const result = solve({
        span: geo.distance,
        height,
        length: inputs.rode,
        weight: chainWeightInWater(options.chainWeight || 0)
      })
      state.geometry = geo
      state.result = result
      state.profile = profile(result)
    }
    last = state
    publish(state)
    status(state)
  }

  function status (state) {
    const r = state.result
    let text
    if (!r) text = 'Waiting for ' + state.missing.join(', ')
    else if (r.state === 'catenary') text = `${r.onBottom.toFixed(0)} m chain on the bottom, ${r.span.toFixed(0)} m to the anchor, lifts at ${r.liftSpan.toFixed(0)} m`
    else if (r.state === 'slack') text = `Chain slack, ${r.onBottom.toFixed(0)} m on the bottom`
    else if (r.state === 'lifting') text = `Chain is lifting the anchor (${(r.anchorAngle * 180 / Math.PI).toFixed(0)}°)`
    else text = 'Rode shorter than the distance to the anchor: check inputs'
    if (text !== lastStatus && app.setPluginStatus) app.setPluginStatus(text)
    lastStatus = text
  }

  function publicSettings () {
    return { chainWeight: options.chainWeight, depthMode: options.depthMode || 'auto', tidePath: options.tidePath, rodePath: options.rodePath }
  }

  // ------------------------------------------------------------- output

  function publish (state) {
    const r = state.result
    const values = []
    const add = (p, v) => values.push({ path: `${OUT}.${p}`, value: v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? null : v })
    if (r) {
      add('state', r.state)
      add('horizontalDistance', r.span)
      add('rollerHeightAboveSeabed', r.height)
      add('waterDepth', state.depth.value)
      add('rodeLength', r.length)
      add('scope', r.scope)
      add('chainOnBottom', r.onBottom)
      add('suspendedLength', r.suspended)
      add('touchdownDistance', r.touchdown)
      add('anchorAngle', r.anchorAngle)
      add('rollerAngle', r.rollerAngle)
      add('horizontalTension', r.horizontalTension)
      add('rollerTension', r.rollerTension)
      add('liftDistance', r.liftSpan)
      add('liftTension', r.liftTension)
      add('bearingFromBow', state.geometry.relativeBearing)
    } else {
      add('state', null)
    }
    const delta = { context: 'vessels.self', updates: [{ values }] }
    const n = notification(state)
    if (n !== undefined) delta.updates[0].values.push({ path: NOTIFICATION, value: n })
    app.handleMessage(plugin.id, delta)
  }

  function notification (state) {
    if (options.notify === false) return undefined
    const s = state.result ? state.result.state : null
    let value = null
    if (s === 'lifting') {
      value = { state: 'warn', method: ['visual', 'sound'], message: `Anchor chain is lifting the anchor (${(state.result.anchorAngle * 180 / Math.PI).toFixed(0)}° at the shank)` }
    } else if (s === 'taut') {
      value = { state: 'warn', method: ['visual'], message: 'Anchor catenary: rode length is shorter than the distance to the anchor. Check anchor position, rode length and depth' }
    } else if (lastNotification) {
      value = { state: 'normal', method: [], message: 'Anchor chain lies on the bottom' }
    }
    const key = value ? value.state + value.message.replace(/\(.*\)/, '') : null
    if (key === lastNotification) return undefined
    lastNotification = value && value.state !== 'normal' ? key : null
    return value
  }

  function sendMeta () {
    const m = (p, units, description) => ({ path: `${OUT}.${p}`, value: Object.assign({ description }, units ? { units } : {}) })
    app.handleMessage(plugin.id, {
      context: 'vessels.self',
      updates: [{
        meta: [
          m('state', null, 'slack, catenary (chain on the bottom), lifting (chain lifts the anchor shank) or taut (inputs disagree)'),
          m('horizontalDistance', 'm', 'Horizontal distance from the bow roller to the anchor'),
          m('rollerHeightAboveSeabed', 'm', 'Height of the bow roller above the seabed at the anchor'),
          m('waterDepth', 'm', 'Water depth at the anchor, tide corrected'),
          m('rodeLength', 'm', 'Chain out from the roller'),
          m('scope', 'ratio', 'Rode length / roller height above the seabed'),
          m('chainOnBottom', 'm', 'Length of chain lying on the seabed'),
          m('suspendedLength', 'm', 'Length of chain hanging between the seabed and the roller'),
          m('touchdownDistance', 'm', 'Horizontal distance from the anchor to where the chain leaves the bottom'),
          m('anchorAngle', 'rad', 'Angle of the chain above the seabed at the anchor; above 0 the shank is lifted'),
          m('rollerAngle', 'rad', 'Angle of the chain below horizontal at the roller'),
          m('horizontalTension', 'N', 'Horizontal pull on the boat and the anchor'),
          m('rollerTension', 'N', 'Chain tension at the roller'),
          m('liftDistance', 'm', 'Horizontal distance roller to anchor at which the chain starts to lift the anchor'),
          m('liftTension', 'N', 'Horizontal pull at which the chain starts to lift the anchor'),
          m('bearingFromBow', 'rad', 'Direction of the anchor relative to the bow, positive to starboard')
        ]
      }]
    })
  }

  // ---------------------------------------------------------- persistence

  function storeFile () {
    const dir = typeof app.getDataDirPath === 'function' ? app.getDataDirPath() : __dirname
    return path.join(dir, 'state.json')
  }

  function load () {
    try { store = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) || {} } catch (e) { store = {} }
  }

  function save () {
    try { fs.writeFileSync(storeFile(), JSON.stringify(store, null, 2)) } catch (e) { app.error(`Could not save state: ${e.message}`) }
  }

  // --------------------------------------------------------------- router

  plugin.registerWithRouter = function (router) {
    // The server usually parses JSON bodies already; parse here if it didn't
    router.use((req, res, next) => {
      if (req.method !== 'POST' || req.body !== undefined) return next()
      let raw = ''
      req.on('data', c => { raw += c })
      req.on('end', () => {
        try { req.body = raw ? JSON.parse(raw) : {} } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }) }
        next()
      })
    })
    router.get('/state', (req, res) => res.json(last || { missing: ['plugin not running'] }))

    // { length: m } or { length: null } to clear
    router.post('/rode', (req, res) => {
      const v = req.body && req.body.length
      if (v !== null && !(Number.isFinite(v) && v >= 0)) return res.status(400).json({ error: 'length must be a number of metres or null' })
      store.manualRode = v === null ? undefined : v
      save(); compute(); res.json(last)
    })

    // { depth: m } charted depth at the anchor below chart datum, or null to clear
    router.post('/seabed', (req, res) => {
      const v = req.body && req.body.depth
      if (v !== null && !Number.isFinite(v)) return res.status(400).json({ error: 'depth must be a number of metres or null' })
      store.manualDatumDepth = v === null ? undefined : v
      save(); compute(); res.json(last)
    })

    // Take the current depth and tide as the depth at the anchor
    router.post('/record', (req, res) => {
      const inputs = gather()
      if (inputs.depth === undefined) return res.status(409).json({ error: 'No live depth' })
      store.record = { anchor: inputs.anchor, time: new Date().toISOString(), depth: inputs.depth, tide: inputs.tide }
      save(); compute(); res.json(last)
    })
  }

  // ------------------------------------------------------------ lifecycle

  plugin.start = function (props) {
    options = Object.assign({}, defaults(), props)
    load()
    sendMeta()
    compute()
    timer = setInterval(() => {
      try { compute() } catch (e) { app.error(e.stack || e.message) }
    }, Math.max(0.5, options.interval || 2) * 1000)
  }

  plugin.stop = function () {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  function defaults () {
    const d = {}
    for (const [k, v] of Object.entries(plugin.schema.properties)) if (v.default !== null && v.default !== undefined) d[k] = v.default
    return d
  }

  plugin.compute = () => { compute(); return last } // for tests

  return plugin
}
