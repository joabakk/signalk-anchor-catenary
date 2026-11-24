/*
 * Signal K plugin: live anchor rode catenary: chain, rope and snubber.
 *
 * Licensed under the Apache License, Version 2.0
 */

const fs = require('fs')
const path = require('path')
const { solve, profile, profileSections, hangBetween, layout, weightInWater, MATERIALS } = require('./lib/catenary')
const { rollerToAnchor, offset } = require('./lib/geometry')

const OUT = 'navigation.anchor.catenary'
const NOTIFICATION = 'notifications.navigation.anchor.catenary'

const WEBAPP = '/signalk-anchor-catenary'

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
  let running = false

  plugin.schema = {
    type: 'object',
    properties: {
      rollerForward: { type: 'number', title: 'Bow roller distance forward of the GPS antenna (m)', description: 'Leave empty to use sensors.gps.fromBow', default: null },
      rollerStarboard: { type: 'number', title: 'Bow roller distance to starboard of the GPS antenna (m)', description: 'Negative for port', default: 0 },
      rollerHeight: { type: 'number', title: 'Bow roller height above the waterline (m)', description: 'Leave empty to use design.bowAnchorRollerHeight', default: null },
      chainWeight: { type: 'number', title: 'Chain weight in air (kg/m)', description: 'For an all-chain rode, and for chain sections below without a weight. e.g. 8 mm: 1.4, 10 mm: 2.2, 12 mm: 3.2, 13 mm: 3.8', default: 2.2 },
      rodeSections: {
        type: 'array',
        title: 'Rode sections, from the anchor end',
        description: 'Leave empty for an all-chain rode of the chain weight above. Otherwise add the sections in order from the anchor, e.g. 20 m of 12 mm chain, then 10 mm chain, or chain and then rope. The last section runs to the boat whatever length is out.',
        default: [],
        items: {
          type: 'object',
          properties: {
            material: { type: 'string', title: 'Material', enum: ['chain', 'nylon', 'polyester'], enumNames: ['Chain', 'Nylon rope', 'Polyester rope'], default: 'chain' },
            length: { type: 'number', title: 'Length (m)', description: 'Not needed for the last section' },
            weight: { type: 'number', title: 'Weight in air (kg/m)', description: 'Chain 8 mm: 1.4, 10 mm: 2.2, 12 mm: 3.2. Nylon rope 14 mm: 0.13, 16 mm: 0.17, 18 mm: 0.21' }
          }
        }
      },
      snubberLength: { type: 'number', title: 'Snubber length (m)', description: 'From the chain hook to where the snubber is made fast. Leave empty if you have no snubber. Hook it on from the webapp', default: null },
      snubberMaterial: { type: 'string', title: 'Snubber material', enum: ['nylon', 'polyester'], enumNames: ['Nylon rope', 'Polyester rope'], default: 'nylon' },
      snubberWeight: { type: 'number', title: 'Snubber weight in air (kg/m)', default: 0.17 },
      snubberAft: { type: 'number', title: 'Snubber made fast: distance aft of the bow roller (m)', description: 'e.g. a stem eye or the bow cleat', default: 0 },
      snubberHeight: { type: 'number', title: 'Snubber made fast: height above the waterline (m)', description: 'Leave empty for the roller height', default: null },
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
      notify: { type: 'boolean', title: 'Notify when the chain lifts the anchor or the inputs disagree', default: true },
      bowStyle: {
        type: 'string',
        title: 'Bow drawn in the webapp',
        enum: ['modern', 'doubleEnder'],
        enumNames: ['Modern yacht', 'Traditional double-ender (Colin Archer type, drawn after the rescue boat RS 21 Solli)'],
        default: 'modern'
      }
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

  function draft () {
    const d = read('design.draft')
    return num(d && typeof d === 'object' ? (d.maximum !== undefined ? d.maximum : d.current) : d)
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
      boatDraft: draft(),
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

  // ---------------------------------------------------- rode and snubber

  // The rode from the anchor end, with weights in water
  function rodeDefinition () {
    const list = (Array.isArray(options.rodeSections) ? options.rodeSections : [])
      .filter(s => s && typeof s === 'object' && MATERIALS[s.material || 'chain'])
    if (!list.length) list.push({ material: 'chain' })
    const sameKind = m => list.filter(s => (s.material || 'chain') === m).length > 1
    return list.map(s => {
      const material = s.material || 'chain'
      const kg = num(s.weight) !== undefined ? s.weight : (material === 'chain' ? num(options.chainWeight) : undefined)
      // tell sections of the same material apart by their weight
      const label = MATERIALS[material].label + (sameKind(material) && kg !== undefined ? ` ${kg} kg/m` : '')
      return { material, kind: MATERIALS[material].kind, label, length: num(s.length), kgPerMetre: kg, weight: weightInWater(kg, material) }
    })
  }

  function snubberConfig () {
    const length = num(options.snubberLength)
    if (!(length > 0)) return undefined
    const material = MATERIALS[options.snubberMaterial] ? options.snubberMaterial : 'nylon'
    return { length, material, kgPerMetre: num(options.snubberWeight), aft: num(options.snubberAft) || 0, height: num(options.snubberHeight) }
  }

  const snubberInfo = cfg => ({ configured: true, length: cfg.length, material: cfg.material, aft: cfg.aft, height: cfg.height })

  // ------------------------------------------------- depth at the anchor

  // Remember the depth and tide when the anchor goes down, so the depth at the
  // anchor can be followed through the tide even when the boat swings away.
  function updateRecord (inputs) {
    const a = node('navigation.anchor.position')
    if (a && a.value === null && (store.record || store.snubber)) {
      store.record = undefined // anchor up
      store.snubber = undefined
      save()
      return
    }
    if (!isPos(inputs.anchor)) return
    const r = store.record
    const moved = r && isPos(r.anchor) ? Math.hypot(...Object.values(offset(r.anchor, inputs.anchor))) : Infinity
    if (moved > 2) {
      store.record = { anchor: inputs.anchor, time: new Date().toISOString(), depth: inputs.depth, tide: inputs.tide }
      if (r) store.snubber = undefined // anchored somewhere else
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

    const rode = rodeDefinition()
    const cfg = snubberConfig()
    const out = inputs.rode !== undefined ? layout(rode, inputs.rode) : []
    const state = {
      time: new Date().toISOString(),
      inputs,
      depth,
      record: store.record,
      manual: { rode: store.manualRode, datumDepth: store.manualDatumDepth },
      settings: publicSettings(),
      rode: rode.map((d, i) => ({ label: d.label, material: d.material, kind: d.kind, length: d.length, kgPerMetre: d.kgPerMetre, out: out[i] ? out[i].length : 0 })),
      snubber: { configured: !!cfg, on: false },
      missing
    }
    if (cfg && store.snubber && inputs.rode !== undefined && inputs.rode < store.snubber.hookAt - 0.5) {
      store.snubber = undefined // hauled in past the hook
      save()
    }
    if (missing.length === 0) {
      const where = forward => rollerToAnchor({
        antenna: inputs.antenna,
        heading: inputs.heading || 0,
        forward,
        starboard: inputs.rollerStarboard,
        anchor: inputs.anchor
      })
      const geo = where(inputs.rollerForward)
      const rollerY = depth.value + inputs.rollerHeight
      let result
      let end = geo.roller // where the load is taken on board

      if (cfg && store.snubber) {
        const s = state.snubber = Object.assign(snubberInfo(cfg), { on: true, hookAt: store.snubber.hookAt, loop: Math.max(0, inputs.rode - store.snubber.hookAt), loaded: false, rollerX: geo.distance, rollerY })
        const fitting = where(inputs.rollerForward - cfg.aft)
        const fitY = depth.value + (cfg.height !== undefined ? cfg.height : inputs.rollerHeight)
        const chain = layout(rode, s.hookAt)
        const r = chain.length && solve({
          span: fitting.distance,
          height: fitY,
          sections: chain.concat([{ kind: 'snubber', material: cfg.material, label: 'Snubber', length: cfg.length, weight: weightInWater(cfg.kgPerMetre, cfg.material) }])
        })
        if (r) {
          // The snubber takes the load if the slack loop of chain from the hook
          // to the roller is long enough to reach
          const ps = profileSections(r)
          const before = ps[ps.length - 2]
          const hook = before.hanging.length ? before.hanging[before.hanging.length - 1] : before.bottom[before.bottom.length - 1]
          const reach = Math.hypot(geo.distance - hook[0], rollerY - hook[1])
          if (r.state === 'taut' || (r.state !== 'slack' && reach <= s.loop + 1e-6)) {
            result = r
            end = fitting.roller
            Object.assign(s, {
              loaded: true,
              hook,
              fittingX: r.span,
              fittingY: r.height,
              tension: r.rollerTension,
              angle: r.rollerAngle,
              loopPoints: hangBetween(hook, [geo.distance, rollerY], s.loop)
            })
          } else if (r.state === 'slack') {
            s.note = 'No pull on the rode, so the snubber carries no load'
          } else {
            s.note = 'The slack loop is too short to reach the hook: the chain takes the load, not the snubber'
          }
        }
      }
      if (!result) result = solve({ span: geo.distance, height: rollerY, sections: out })

      state.geometry = geo
      state.end = end
      state.result = result
      state.sections = profileSections(result)
      state.profile = profile(result)
    } else if (cfg && store.snubber) {
      Object.assign(state.snubber, snubberInfo(cfg), { on: true, hookAt: store.snubber.hookAt })
    }
    last = state
    publish(state)
    status(state)
  }

  function status (state) {
    const r = state.result
    let text
    if (!r) text = 'Waiting for ' + state.missing.join(', ')
    else if (r.state === 'catenary') text = `${r.onBottom.toFixed(0)} m ${r.ropeOnBottom > 0 ? 'rode' : 'chain'} on the bottom, ${r.span.toFixed(0)} m to the anchor, lifts at ${r.liftSpan.toFixed(0)} m`
    else if (r.state === 'slack') text = `Rode slack, ${r.onBottom.toFixed(0)} m on the bottom`
    else if (r.state === 'lifting') text = `Rode is lifting the anchor (${(r.anchorAngle * 180 / Math.PI).toFixed(0)}°)`
    else text = 'Rode shorter than the distance to the anchor: check inputs'
    if (r && state.snubber.loaded) text += ', on the snubber'
    if (text !== lastStatus && app.setPluginStatus) app.setPluginStatus(text)
    lastStatus = text
  }

  function publicSettings () {
    return { chainWeight: options.chainWeight, depthMode: options.depthMode || 'auto', tidePath: options.tidePath, rodePath: options.rodePath, snubberLength: num(options.snubberLength), bowStyle: options.bowStyle || 'modern' }
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
      add('rodeLength', state.inputs.rode)
      add('scope', r.scope)
      add('chainOnBottom', r.onBottom)
      add('ropeOnBottom', r.ropeOnBottom)
      add('suspendedLength', r.suspended)
      add('touchdownDistance', r.touchdown)
      add('anchorAngle', r.anchorAngle)
      add('rollerAngle', r.rollerAngle)
      add('horizontalTension', r.horizontalTension)
      add('rollerTension', r.rollerTension)
      add('liftDistance', r.liftSpan)
      add('liftTension', r.liftTension)
      add('bearingFromBow', state.geometry.relativeBearing)
      add('snubberLoaded', state.snubber.configured ? !!state.snubber.loaded : null)
      add('snubberTension', state.snubber.loaded ? state.snubber.tension : null)
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
      value = { state: 'warn', method: ['visual', 'sound'], message: `Anchor rode is lifting the anchor (${(state.result.anchorAngle * 180 / Math.PI).toFixed(0)}° at the shank)` }
    } else if (s === 'taut') {
      value = { state: 'warn', method: ['visual'], message: 'Anchor catenary: rode length is shorter than the distance to the anchor. Check anchor position, rode length and depth' }
    } else if (lastNotification) {
      value = { state: 'normal', method: [], message: 'Anchor rode lies on the bottom again' }
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
          m('state', null, 'slack, catenary (rode on the bottom), lifting (rode lifts the anchor shank) or taut (inputs disagree)'),
          m('horizontalDistance', 'm', 'Horizontal distance from the bow roller to the anchor'),
          m('rollerHeightAboveSeabed', 'm', 'Height of the bow roller above the seabed at the anchor'),
          m('waterDepth', 'm', 'Water depth at the anchor, tide corrected'),
          m('rodeLength', 'm', 'Rode out from the roller'),
          m('scope', 'ratio', 'Length of the rode carrying the load / height above the seabed where it is made fast'),
          m('chainOnBottom', 'm', 'Length of rode lying on the seabed, chain and rope'),
          m('ropeOnBottom', 'm', 'Length of rope lying on the seabed'),
          m('suspendedLength', 'm', 'Length of rode hanging between the seabed and the boat'),
          m('touchdownDistance', 'm', 'Horizontal distance from the anchor to where the rode leaves the bottom'),
          m('anchorAngle', 'rad', 'Angle of the rode above the seabed at the anchor; above 0 the shank is lifted'),
          m('rollerAngle', 'rad', 'Angle of the rode below horizontal where the load is taken: the roller, or the snubber fitting when the snubber is loaded'),
          m('horizontalTension', 'N', 'Horizontal pull on the boat and the anchor'),
          m('rollerTension', 'N', 'Tension where the load is taken: the roller, or the snubber fitting when the snubber is loaded'),
          m('liftDistance', 'm', 'Horizontal distance from the anchor at which the rode starts to lift the anchor'),
          m('liftTension', 'N', 'Horizontal pull at which the rode starts to lift the anchor'),
          m('bearingFromBow', 'rad', 'Direction of the anchor relative to the bow, positive to starboard'),
          m('snubberLoaded', null, 'True when the snubber, not the chain over the roller, takes the load'),
          m('snubberTension', 'N', 'Tension in the snubber')
        ]
      }]
    })
  }

  // ---------------------------------------------------------- persistence

  // The plugin's data directory, or none: then the state is kept in memory only
  function storeFile () {
    const dir = typeof app.getDataDirPath === 'function' ? app.getDataDirPath() : undefined
    return typeof dir === 'string' && dir ? path.join(dir, 'state.json') : undefined
  }

  function load () {
    const file = storeFile()
    try { store = (file && JSON.parse(fs.readFileSync(file, 'utf8'))) || {} } catch (e) { store = {} }
  }

  function save () {
    const file = storeFile()
    if (!file) return
    try { fs.writeFileSync(file, JSON.stringify(store, null, 2)) } catch (e) { app.error(`Could not save state: ${e.message}`) }
  }

  // --------------------------------------------------------------- router

  // The handlers, shared by the plugin's own routes and the app-path API below
  const handlers = {
    state (req, res) {
      res.json(last || { missing: ['plugin not running'] })
    },

    // { length: m } or { length: null } to clear
    rode (req, res) {
      const v = req.body && req.body.length
      if (v !== null && !(Number.isFinite(v) && v >= 0)) return res.status(400).json({ error: 'length must be a number of metres or null' })
      store.manualRode = v === null ? undefined : v
      save(); compute(); res.json(last)
    },

    // { depth: m } charted depth at the anchor below chart datum, or null to clear
    seabed (req, res) {
      const v = req.body && req.body.depth
      if (v !== null && !Number.isFinite(v)) return res.status(400).json({ error: 'depth must be a number of metres or null' })
      store.manualDatumDepth = v === null ? undefined : v
      save(); compute(); res.json(last)
    },

    // { on: true, loop: m } hooks the snubber on, with `loop` metres of chain let out
    // after hooking on; { on: false } takes it off
    snubber (req, res) {
      const b = req.body || {}
      if (b.on === false) {
        store.snubber = undefined
        save(); compute(); return res.json(last)
      }
      if (b.on !== true) return res.status(400).json({ error: 'on must be true or false' })
      if (!snubberConfig()) return res.status(409).json({ error: 'Set the snubber length in the plugin settings first' })
      const loop = b.loop === undefined || b.loop === null ? 0 : b.loop
      if (!(Number.isFinite(loop) && loop >= 0)) return res.status(400).json({ error: 'loop must be a number of metres' })
      const rodeOut = gather().rode
      if (rodeOut === undefined) return res.status(409).json({ error: 'No rode length' })
      if (loop >= rodeOut) return res.status(400).json({ error: 'The loop must be shorter than the rode out' })
      const hooked = layout(rodeDefinition(), rodeOut - loop)
      if (hooked.length && hooked[hooked.length - 1].kind !== 'chain') return res.status(400).json({ error: 'The hook would be on the rope: let out less after hooking on, or hook the snubber on the chain' })
      store.snubber = { hookAt: rodeOut - loop, time: new Date().toISOString() }
      save(); compute(); res.json(last)
    },

    // Take the current depth and tide as the depth at the anchor
    record (req, res) {
      const inputs = gather()
      if (inputs.depth === undefined) return res.status(409).json({ error: 'No live depth' })
      store.record = { anchor: inputs.anchor, time: new Date().toISOString(), depth: inputs.depth, tide: inputs.tide }
      save(); compute(); res.json(last)
    }
  }
  const SETTERS = ['rode', 'seabed', 'snubber', 'record']

  // Parse a JSON body if the server hasn't already
  function jsonBody (req, res, next) {
    if (req.method !== 'POST' || req.body !== undefined) return next()
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      try { req.body = raw ? JSON.parse(raw) : {} } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }) }
      next()
    })
  }

  plugin.registerWithRouter = function (router) {
    // Signal K 2.37 and later lets a plugin open its routes to users who are not
    // admins: reading to any logged-in user, setting values to read/write users.
    // Older servers keep all plugin routes admin-only.
    const read = typeof router.access === 'function' ? router.access('readonly') : router
    const write = typeof router.access === 'function' ? router.access('readwrite') : router
    router.use(jsonBody)
    read.get('/state', handlers.state)
    for (const name of SETTERS) write.post('/' + name, handlers[name])
  }

  /*
   * The same API under the webapp's own path, /signalk-anchor-catenary/api/.
   * Devices that show the webapp without a login of their own, such as B&G/Simrad/
   * Lowrance MFDs through signalk-navico-embedder (which forwards only an app's own
   * paths and /signalk), read with a read-only token or with the server's Allow
   * Read-Only Access. Plugin routes accept neither before Signal K 2.37, and only
   * a logged-in user after. These routes sit outside the server's plugin route
   * guard, so they apply the rules themselves from what the server has already
   * worked out for the request: reading as for /signalk (any login, or anyone when
   * the server allows read-only access), setting values with a read/write or admin
   * login.
   */
  function access (req) {
    const security = app.securityStrategy
    if (!security || (typeof security.isDummy === 'function' && security.isDummy())) return 'write'
    const p = req.skIsAuthenticated ? req.skPrincipal : undefined
    if (p && (p.permissions === 'admin' || p.permissions === 'readwrite')) return 'write'
    if (p) return 'read'
    if (typeof security.allowReadOnly === 'function' && security.allowReadOnly()) return 'read'
    return 'none'
  }

  const guard = level => (req, res, next) => {
    if (!running) return res.status(503).json({ error: 'The anchor catenary plugin is not running' })
    const a = access(req)
    if (a === 'write' || (level === 'read' && a === 'read')) return next()
    res.status(a === 'none' ? 401 : 403).json({ error: a === 'none' ? 'Log in first' : 'Read/write access needed' })
  }

  // Values are only set from JSON, which a form on another web site can't send
  function requireJson (req, res, next) {
    if (typeof req.is === 'function' ? req.is('application/json') : /^application\/json/.test(req.headers['content-type'] || '')) return next()
    res.status(415).json({ error: 'Send JSON (Content-Type: application/json)' })
  }

  let appRoutesMounted = false
  function mountAppRoutes () {
    if (appRoutesMounted || typeof app.get !== 'function' || typeof app.post !== 'function') return
    try {
      app.get(`${WEBAPP}/api/state`, guard('read'), handlers.state)
      for (const name of SETTERS) app.post(`${WEBAPP}/api/${name}`, guard('write'), requireJson, jsonBody, handlers[name])
      appRoutesMounted = true
    } catch (e) {
      app.error(`Could not add the API under ${WEBAPP}/api: ${e.message}`)
    }
  }

  // ------------------------------------------- chart plotter extension

  // Screen widgets and a toolbar button for chart plotters that read the
  // plotterExtensions resource type, such as Freeboard-SK. The pages are served
  // with the webapp, from public/.
  let providerRegistered = false

  function manifest () {
    const widget = (id, title, size) => ({ id, title, type: 'iframe', url: `${WEBAPP}/widget.html?view=${id}`, size, lifecycle: 'whileEnabled' })
    return {
      name: 'Anchor Catenary',
      description: 'The anchor rode as it lies now: rode on the bottom, margin before the anchor lifts, and the full side and plan views',
      version: require('./package.json').version,
      apiVersion: '1',
      requires: ['widgets'],
      optional: ['panels.iframe', 'buttons', 'windows', 'nightMode', 'display'],
      widgets: [
        widget('profile', 'Anchor rode: side view', '2x1'),
        widget('profile-large', 'Anchor rode: side view and numbers', '2x2'),
        widget('status', 'Anchor rode: status', '1x1')
      ],
      panels: [
        { id: 'app', title: 'Anchor catenary', type: 'iframe', url: `${WEBAPP}/`, lifecycle: 'onOpen' }
      ],
      buttons: [
        {
          id: 'app',
          title: 'Anchor catenary',
          icon: 'anchor',
          action: { type: 'toggleWindow', panel: 'app', geometry: { anchor: 'bottom-right', width: 760, height: 620 }, restoreKey: 'app' }
        }
      ]
    }
  }

  function registerPlotterExtension () {
    if (providerRegistered || typeof app.registerResourceProvider !== 'function') return
    try {
      app.registerResourceProvider({
        type: 'plotterExtensions',
        methods: {
          listResources: async () => (running ? { [plugin.id]: manifest() } : {}),
          getResource: async id => {
            if (!running || id !== plugin.id) throw new Error(`No such plotterExtensions resource: ${id}`)
            return manifest()
          },
          setResource: async () => { throw new Error(`${plugin.id} is read-only`) },
          deleteResource: async () => { throw new Error(`${plugin.id} is read-only`) }
        }
      })
      providerRegistered = true
    } catch (e) {
      app.error(`Could not register the chart plotter widgets: ${e.message}`)
    }
  }

  plugin.manifest = manifest // for tests

  // ------------------------------------------------------------ lifecycle

  plugin.start = function (props) {
    options = Object.assign({}, defaults(), props)
    running = true
    registerPlotterExtension()
    mountAppRoutes()
    load()
    sendMeta()
    compute()
    timer = setInterval(() => {
      try { compute() } catch (e) { app.error(e.stack || e.message) }
    }, Math.max(0.5, options.interval || 2) * 1000)
  }

  plugin.stop = function () {
    running = false
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
