/* Anchor catenary webapp: polls the plugin and draws the chain. */
(function () {
  const API = '/plugins/signalk-anchor-catenary'
  const NS = 'http://www.w3.org/2000/svg'
  const $ = id => document.getElementById(id)
  const DEG = 180 / Math.PI
  const G = 9.80665

  let state = null
  let editing = false // don't overwrite inputs while the user types

  // ------------------------------------------------------------- helpers

  const fin = v => typeof v === 'number' && Number.isFinite(v)
  const m = (v, d = 1) => (fin(v) ? v.toFixed(d) + ' m' : '–')
  const deg = v => (fin(v) ? (v * DEG).toFixed(0) + '°' : '–')
  const force = v => (fin(v) ? `${Math.round(v / G)} kgf <span class="small">${(v / 1000).toFixed(2)} kN</span>` : '–')

  function el (name, attrs, parent, text) {
    const e = document.createElementNS(NS, name)
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v)
    if (text !== undefined) e.textContent = text
    if (parent) parent.appendChild(e)
    return e
  }

  function css (name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  }

  // east/north metres of `to` from `from`
  function offset (from, to) {
    const R = 6371008.8
    const lat = (from.latitude + to.latitude) / 2 * Math.PI / 180
    return {
      e: (to.longitude - from.longitude) * Math.PI / 180 * R * Math.cos(lat),
      n: (to.latitude - from.latitude) * Math.PI / 180 * R
    }
  }

  // ------------------------------------------------------------ side view

  function drawSide () {
    const svg = $('side')
    svg.innerHTML = ''
    const r = state && state.result
    if (!r) {
      el('text', { x: '50%', y: '50%', 'text-anchor': 'middle', class: 'muted' }, svg, 'Waiting for data')
      return
    }
    const ex = Number($('exaggerate').value) || 1
    const depth = state.depth.value
    const rollerH = r.height // above seabed
    const surface = depth
    const tide = state.inputs.tide
    const bowExtent = Math.max(4, Math.min(12, (state.inputs.boatLength || 10) * 0.5))
    const xMax = Math.max(r.span, fin(r.liftSpan) ? Math.min(r.liftSpan, r.span * 1.6) : 0) + bowExtent
    // at least 30 m wide, so the boat doesn't fill the view when it lies over the anchor
    const xMin = Math.min(-Math.max(3, r.span * 0.06), xMax - 30)
    const yMax = Math.max(rollerH, surface) + 1
    // draw in screen pixels so text stays readable on a phone; height fits the content
    const W = Math.round(Math.max(320, Math.min(1000, svg.clientWidth || 1000)))
    const narrow = W < 600
    const pad = narrow ? 12 : 30
    const top = 40 // label rows above the drawing
    const bottom = 46 // seabed band with two label rows
    const maxH = narrow ? W * 0.9 : 420
    const sx = (W - 2 * pad) / (xMax - xMin)
    const sy = Math.min(sx * ex, (maxH - top - bottom) / yMax)
    const H = Math.round(top + yMax * sy + bottom)
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    const px = x => pad + (x - xMin) * sx
    const py = y => top + (yMax - y) * sy
    const pts = list => list.map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(' ')

    // water and seabed
    el('rect', { x: 0, y: py(surface), width: W, height: py(0) - py(surface), fill: css('--water') }, svg)
    el('line', { x1: 0, x2: W, y1: py(surface), y2: py(surface), stroke: css('--water-edge'), 'stroke-width': 2 }, svg)
    el('rect', { x: 0, y: py(0), width: W, height: H - py(0), fill: css('--seabed') }, svg)
    if (fin(tide)) {
      const cd = surface - tide
      el('line', { x1: 0, x2: W, y1: py(cd), y2: py(cd), stroke: css('--datum'), 'stroke-dasharray': '6 5', 'stroke-width': 1.5 }, svg)
      el('text', { x: 6, y: py(cd) - 4, class: 'muted' }, svg, `${narrow ? 'CD' : 'chart datum'} (tide ${tide >= 0 ? '+' : ''}${tide.toFixed(2)} m)`)
    }

    // where the anchor would start to lift
    if (fin(r.liftSpan) && r.liftSpan > 0 && px(r.liftSpan) < W - 20) {
      el('line', { x1: px(r.liftSpan), x2: px(r.liftSpan), y1: 18, y2: py(0), stroke: css('--warn'), 'stroke-dasharray': '4 4', 'stroke-width': 1.5 }, svg)
      const right = px(r.liftSpan) > W * 0.6
      el('text', { x: px(r.liftSpan) + (right ? -6 : 6), y: 14, 'text-anchor': right ? 'end' : 'start', fill: css('--warn') }, svg, narrow ? `lifts at ${r.liftSpan.toFixed(0)} m` : `anchor lifts with roller here (${r.liftSpan.toFixed(0)} m)`)
    }

    // bow
    const X = r.span
    const deckY = rollerH + 0.3
    const keelY = Math.max(surface - 1.5, 0.3)
    el('polygon', {
      points: pts([[X, rollerH], [X + 0.3, deckY], [X + bowExtent, deckY + 0.2], [X + bowExtent, keelY], [X + bowExtent * 0.35, keelY], [X + 0.6, surface - 0.3]]),
      fill: css('--boat'), stroke: css('--boat-edge'), 'stroke-width': 2, 'stroke-linejoin': 'round'
    }, svg)
    el('circle', { cx: px(X), cy: py(rollerH), r: 5, fill: css('--accent') }, svg)

    // chain
    const prof = state.profile || []
    if (r.state === 'catenary' && r.touchdown > 0) {
      el('polyline', { points: pts([[0, 0], [r.touchdown, 0]]), fill: 'none', stroke: css('--bottom-chain'), 'stroke-width': 5 }, svg)
      el('circle', { cx: px(r.touchdown), cy: py(0), r: 4, fill: css('--bottom-chain') }, svg)
      el('text', { x: Math.min(Math.max(px(r.touchdown), 90), W - 90), y: py(0) + 17, 'text-anchor': 'middle' }, svg, narrow ? `off bottom at ${r.touchdown.toFixed(1)} m` : `leaves bottom ${r.touchdown.toFixed(1)} m from anchor`)
    }
    let hanging = r.state === 'catenary' && r.touchdown > 0 ? prof.slice(1) : prof
    if (r.state === 'slack') {
      // chain along the bottom to the foot of the roller, the rest piled up there
      // (where it really lies is unknown: it depends on how the boat moved)
      hanging = [[X, 0], [X, rollerH]]
      if (X > 0) el('polyline', { points: pts([[0, 0], [X, 0]]), fill: 'none', stroke: css('--bottom-chain'), 'stroke-width': 5 }, svg)
      const extra = r.onBottom - X
      if (extra > 0.5) {
        const half = Math.max(10, Math.min(70, Math.sqrt(extra) * 9))
        const loops = Math.max(3, Math.round(half / 6))
        const fx = px(X); const fy = py(0)
        let d = `M${fx - half},${fy}`
        for (let i = 0; i < loops; i++) {
          const x0 = fx - half + (2 * half) * i / loops
          const x1 = fx - half + (2 * half) * (i + 1) / loops
          const hgt = 4 + 8 * Math.sin(Math.PI * (i + 0.5) / loops) // a mound
          d += ` C${x0},${fy - hgt} ${x1},${fy - hgt} ${x1},${fy}`
        }
        el('path', { d, fill: 'none', stroke: css('--bottom-chain'), 'stroke-width': 3, 'stroke-linejoin': 'round' }, svg)
        el('text', { x: Math.min(Math.max(fx, 110), W - 110), y: py(0) + 17, 'text-anchor': 'middle' }, svg, `${extra.toFixed(0)} m slack lying on the bottom`)
      }
    }
    const chainColor = r.state === 'lifting' ? css('--alarm') : r.state === 'taut' ? css('--warn') : css('--chain')
    el('polyline', { points: pts(hanging), fill: 'none', stroke: chainColor, 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-dasharray': r.state === 'taut' ? '8 6' : '' }, svg)

    // anchor
    const ax = px(0); const ay = py(0)
    const a = el('g', { transform: `translate(${ax},${ay})`, stroke: css('--chain'), 'stroke-width': 2.5, fill: 'none', 'stroke-linecap': 'round' }, svg)
    el('path', { d: 'M0,-2 L-16,-2 M-16,-2 L-22,-9 M-16,-2 L-10,-10' }, a)
    if (r.state === 'lifting') {
      el('text', { x: ax + 8, y: ay - 14, fill: css('--alarm') }, svg, `shank lifted ${deg(r.anchorAngle)}`)
    }

    // dimensions
    el('text', { x: px(X) - 10, y: Math.max(32, py(rollerH) - 8), 'text-anchor': 'end' }, svg, `${deg(r.rollerAngle)} at roller`)
    el('text', { x: W / 2, y: py(0) + 37, 'text-anchor': 'middle' }, svg, `${r.span.toFixed(1)} m to anchor · ${depth.toFixed(1)} m deep`)
  }

  // ------------------------------------------------------------ plan view

  function drawPlan () {
    const svg = $('plan')
    svg.innerHTML = ''
    const s = state
    if (!s || !s.result || !s.geometry) {
      el('text', { x: 200, y: 200, 'text-anchor': 'middle', class: 'muted' }, svg, 'Waiting for data')
      return
    }
    const r = s.result
    const anchor = s.inputs.anchor
    const ant = offset(anchor, s.inputs.antenna)
    const rol = offset(anchor, s.geometry.roller)
    const L = s.inputs.boatLength || 10
    const B = s.inputs.boatBeam || L / 3
    const reach = Math.max(r.maxSpan || 0, Math.hypot(ant.e, ant.n) + L) * 1.1
    const k = 180 / reach
    const X = e => 200 + e * k
    const Y = n => 200 - n * k

    el('circle', { cx: 200, cy: 200, r: (r.maxSpan || 0) * k, fill: 'none', stroke: css('--line'), 'stroke-dasharray': '3 4' }, svg)
    if (fin(r.liftSpan)) el('circle', { cx: 200, cy: 200, r: r.liftSpan * k, fill: 'none', stroke: css('--warn'), 'stroke-dasharray': '6 5' }, svg)
    el('text', { x: 200, y: 200 - (r.liftSpan || 0) * k - 4, 'text-anchor': 'middle', fill: css('--warn'), 'font-size': 11 }, svg, 'roller here lifts anchor')

    // hull, bow at the roller
    const hdg = s.inputs.heading || 0
    const fwd = s.inputs.rollerForward
    const outline = [[0, 0], [-0.25 * L, B / 2], [-0.7 * L, B / 2], [-L, B * 0.4], [-L, -B * 0.4], [-0.7 * L, -B / 2], [-0.25 * L, -B / 2]]
      .map(([f, st]) => {
        f += fwd; st += s.inputs.rollerStarboard
        const e = ant.e + f * Math.sin(hdg) + st * Math.cos(hdg)
        const n = ant.n + f * Math.cos(hdg) - st * Math.sin(hdg)
        return `${X(e).toFixed(1)},${Y(n).toFixed(1)}`
      }).join(' ')
    el('polygon', { points: outline, fill: css('--boat'), stroke: css('--boat-edge'), 'stroke-width': 1.5 }, svg)

    // chain line: solid where it hangs, brown where it lies
    const tdFrac = r.state === 'catenary' ? r.touchdown / r.span : 0
    el('line', { x1: X(0), y1: Y(0), x2: X(rol.e * tdFrac), y2: Y(rol.n * tdFrac), stroke: css('--bottom-chain'), 'stroke-width': 4 }, svg)
    el('line', { x1: X(rol.e * tdFrac), y1: Y(rol.n * tdFrac), x2: X(rol.e), y2: Y(rol.n), stroke: r.state === 'lifting' ? css('--alarm') : css('--chain'), 'stroke-width': 2 }, svg)
    el('circle', { cx: X(rol.e), cy: Y(rol.n), r: 3.5, fill: css('--accent') }, svg)
    el('circle', { cx: X(ant.e), cy: Y(ant.n), r: 2.5, fill: css('--muted') }, svg)
    const a = el('g', { transform: 'translate(200,200)', stroke: css('--chain'), 'stroke-width': 2, fill: 'none' }, svg)
    el('path', { d: 'M0,-9 L0,8 M-7,3 Q0,12 7,3 M-5,-5 L5,-5' }, a)
    el('text', { x: 392, y: 392, 'text-anchor': 'end', class: 'muted', 'font-size': 11 }, svg, `ring ${(r.maxSpan || 0).toFixed(0)} m = chain bar tight`)
  }

  // ---------------------------------------------------------------- stats

  function row (dl, label, value, cls) {
    const dt = document.createElement('dt'); dt.textContent = label
    const dd = document.createElement('dd'); dd.innerHTML = value
    if (cls) dd.className = cls
    dl.append(dt, dd)
  }

  const STATES = {
    slack: ['Slack', 'ok'],
    catenary: ['Chain on bottom', 'ok'],
    lifting: ['Lifting anchor', 'alarm'],
    taut: ['Inputs disagree', 'warn']
  }

  function drawStats () {
    const s = state
    const r = s && s.result
    const badge = $('badge')
    const [text, cls] = r ? STATES[r.state] : ['Waiting', '']
    badge.textContent = text
    badge.className = 'badge ' + cls

    const dl = $('stats'); dl.innerHTML = ''
    if (r) {
      row(dl, 'Chain out', m(r.length, 0) + ` <span class="small">scope ${r.scope.toFixed(1)}:1</span>`)
      row(dl, 'On the bottom', m(r.onBottom), r.state === 'lifting' ? 'alarm' : (r.onBottom < 3 ? 'warn' : ''))
      row(dl, 'Hanging', m(r.suspended))
      row(dl, 'Roller to anchor', m(r.span))
      const margin = r.liftSpan - r.span
      row(dl, 'Anchor lifts at', m(r.liftSpan) + (r.state !== 'taut' ? ` <span class="small">${margin >= 0 ? margin.toFixed(1) + ' m to go' : 'passed'}</span>` : ''), margin < 2 ? 'warn' : '')
      row(dl, 'Angle at anchor', deg(r.anchorAngle), r.anchorAngle > 0.01 ? 'alarm' : '')
      row(dl, 'Angle at roller', deg(r.rollerAngle))
      row(dl, 'Pull on anchor', force(r.horizontalTension))
      row(dl, 'Tension at roller', force(r.rollerTension))
      row(dl, 'Pull to lift anchor', force(r.liftTension))
      const rb = s.geometry.relativeBearing
      row(dl, 'Anchor bearing', fin(rb) ? `${Math.abs(rb * DEG).toFixed(0)}° ${rb >= 0 ? 'stbd' : 'port'} of bow` : '–')
    }

    const ins = $('inputs'); ins.innerHTML = ''
    if (s && s.inputs) {
      const i = s.inputs
      row(ins, 'Depth at anchor', m(s.depth.value) + ` <span class="small">${s.depth.source}</span>`)
      if (fin(s.depth.tideChange)) row(ins, 'Tide since drop', `${s.depth.tideChange >= 0 ? '+' : ''}${s.depth.tideChange.toFixed(2)} m`)
      row(ins, 'Depth under boat', m(i.depth))
      row(ins, 'Tide', fin(i.tide) ? `${i.tide.toFixed(2)} m` : '–')
      row(ins, 'Roller height', m(i.rollerHeight, 2) + ` <span class="small">${i.rollerHeightSource}</span>`)
      row(ins, 'Roller ahead of GPS', m(i.rollerForward, 1) + ` <span class="small">${i.rollerForwardSource}</span>`)
      row(ins, 'Chain weight', fin(s.settings.chainWeight) ? `${s.settings.chainWeight} kg/m` : '–')
      row(ins, 'Rode length', m(i.rode, 0) + ` <span class="small">${i.rodeSource || 'not set'}</span>`)
      if (s.record && s.record.time) row(ins, 'Anchor down', new Date(s.record.time).toLocaleTimeString() + (fin(s.record.depth) ? ` <span class="small">${s.record.depth.toFixed(1)} m${fin(s.record.tide) ? ', tide ' + s.record.tide.toFixed(2) + ' m' : ''}</span>` : ''))

      $('rodeNote').textContent = i.rodeSource === 'sensor'
        ? `Chain counter (${s.settings.rodePath}) is used; the value here is only a fallback.`
        : 'No chain counter: enter the chain out from the roller.'
      if (!editing) {
        if (fin(s.manual.rode)) $('rode').value = s.manual.rode
        if (fin(s.manual.datumDepth)) $('seabed').value = s.manual.datumDepth
      }
    }

    const miss = $('missing')
    miss.hidden = !(s && s.missing && s.missing.length)
    if (!miss.hidden) miss.textContent = 'Waiting for: ' + s.missing.join(', ')
  }

  function draw () {
    drawStats(); drawSide(); drawPlan()
  }

  // ------------------------------------------------------------- network

  async function poll () {
    try {
      const res = await fetch(API + '/state', { credentials: 'include' })
      if (!res.ok) throw new Error(res.status === 404 ? 'Plugin not enabled' : `HTTP ${res.status}`)
      state = await res.json()
      showError()
      draw()
    } catch (e) {
      showError(`Can't read the plugin: ${e.message}`)
    }
  }

  async function post (p, body) {
    try {
      const res = await fetch(API + p, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || (res.status === 401 || res.status === 403 ? 'log in to the server first' : `HTTP ${res.status}`))
      state = j; showError(); draw()
    } catch (e) {
      showError(e.message)
    }
  }

  function showError (msg) {
    $('error').hidden = !msg
    $('error').textContent = msg || ''
  }

  // ---------------------------------------------------------------- wiring

  const numberOrNull = v => (v === '' ? null : Number(v))
  for (const id of ['rode', 'seabed']) {
    $(id).addEventListener('focus', () => { editing = true })
    $(id).addEventListener('blur', () => { editing = false })
  }
  $('rodeForm').addEventListener('submit', e => { e.preventDefault(); editing = false; post('/rode', { length: numberOrNull($('rode').value) }) })
  $('rodeClear').addEventListener('click', () => { $('rode').value = ''; post('/rode', { length: null }) })
  $('seabedForm').addEventListener('submit', e => { e.preventDefault(); editing = false; post('/seabed', { depth: numberOrNull($('seabed').value) }) })
  $('seabedClear').addEventListener('click', () => { $('seabed').value = ''; post('/seabed', { depth: null }) })
  $('record').addEventListener('click', () => post('/record'))

  const prefs = (() => { try { return JSON.parse(localStorage.getItem('anchor-catenary') || '{}') } catch (e) { return {} } })()
  const savePrefs = () => { try { localStorage.setItem('anchor-catenary', JSON.stringify(prefs)) } catch (e) {} }
  if (prefs.exaggerate) $('exaggerate').value = prefs.exaggerate
  if (prefs.night) document.documentElement.dataset.theme = 'night'
  $('exaggerate').addEventListener('change', () => { prefs.exaggerate = $('exaggerate').value; savePrefs(); draw() })
  $('night').addEventListener('click', () => {
    prefs.night = !prefs.night
    if (prefs.night) document.documentElement.dataset.theme = 'night'
    else delete document.documentElement.dataset.theme
    savePrefs(); draw()
  })

  window.addEventListener('resize', () => { if (state) drawSide() })
  poll()
  setInterval(poll, 2000)
})()
