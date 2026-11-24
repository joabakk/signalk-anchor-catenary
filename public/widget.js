/*
 * Anchor catenary widgets for chart plotters (Freeboard-SK screen widgets).
 * One page, three views, picked by the widget id the plotter hands over, or by
 * ?view= when opened on its own:
 *   profile        side view of the rode (2x1)
 *   profile-large  side view and the key numbers (2x2)
 *   status         state, rode on the bottom and margin to lift-off (1x1)
 */
(function () {
  // the API under the webapp's path, else the plugin route on servers without it
  const APIS = ['api/state', '/plugins/signalk-anchor-catenary/state']
  let api = 0
  const NS = 'http://www.w3.org/2000/svg'
  const G = 9.80665
  const card = document.getElementById('card')

  let view = new URLSearchParams(location.search).get('view') || 'profile'
  let state = null
  let error = null

  const fin = v => typeof v === 'number' && Number.isFinite(v)
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const m = (v, d = 1) => (fin(v) ? v.toFixed(d) + ' m' : '–')

  function el (name, attrs, parent, text) {
    const e = document.createElementNS(NS, name)
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v)
    if (text !== undefined) e.textContent = text
    if (parent) parent.appendChild(e)
    return e
  }

  function html (tag, cls, text, parent) {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    if (parent) parent.appendChild(e)
    return e
  }

  // ------------------------------------------------------------- summary

  function summary (s) {
    const r = s.result
    const sn = s.snubber || {}
    const margin = r.liftSpan - r.span
    switch (r.state) {
      case 'lifting': return { text: `Lifting anchor ${Math.round(r.anchorAngle * 180 / Math.PI)}°`, cls: 'alarm', margin }
      case 'taut': return { text: 'Inputs disagree', cls: 'warn', margin }
      case 'slack': return { text: 'Slack', cls: 'ok', margin }
      default: return { text: sn.loaded ? 'On snubber' : 'Rode on bottom', cls: margin < 2 ? 'warn' : 'ok', margin }
    }
  }

  // ------------------------------------------------------------ side view

  function drawSide (svg) {
    svg.innerHTML = ''
    const W = Math.max(60, svg.clientWidth)
    const H = Math.max(30, svg.clientHeight)
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    const r = state.result
    const sn = state.snubber || {}
    const depth = state.depth.value
    const rollerX = sn.loaded ? sn.rollerX : r.span
    const rollerY = sn.loaded ? sn.rollerY : r.height
    const bowExtent = Math.max(2, r.span * 0.08)
    const bow = Bow.side(state.settings && state.settings.bowStyle, { x: rollerX, y: rollerY, surface: depth, extent: bowExtent, length: state.inputs.boatLength })
    const showLift = fin(r.liftSpan) && r.liftSpan > 0 && r.liftSpan < r.span * 1.5
    const xMin = -Math.max(1, r.span * 0.04)
    // a modern bow is cut off; the double-ender is shown whole
    const xMax = Math.max(r.span, rollerX, showLift ? r.liftSpan : 0) + (bow.lines.length ? bow.length * 0.6 : bowExtent)
    const yMax = Math.max(rollerY, depth) + 0.6
    const bottom = 5
    // fitted to the box: the vertical scale is exaggerated, as in a chart profile
    const sx = W / (xMax - xMin)
    const sy = (H - bottom - 2) / yMax
    const px = x => (x - xMin) * sx
    const py = y => 2 + (yMax - y) * sy
    const pts = list => list.map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(' ')

    el('rect', { x: 0, y: py(depth), width: W, height: py(0) - py(depth), fill: css('--water') }, svg)
    el('line', { x1: 0, x2: W, y1: py(depth), y2: py(depth), stroke: css('--water-edge'), 'stroke-width': 1 }, svg)
    el('rect', { x: 0, y: py(0), width: W, height: H - py(0), fill: css('--seabed') }, svg)
    if (showLift) {
      el('line', { x1: px(r.liftSpan), x2: px(r.liftSpan), y1: 0, y2: py(0), stroke: css('--warn'), 'stroke-dasharray': '3 3', 'stroke-width': 1 }, svg)
    }

    // bow
    el('polygon', { points: pts(bow.hull), fill: css('--line'), stroke: css('--muted'), 'stroke-width': 1, 'stroke-linejoin': 'round' }, svg)
    for (const line of bow.lines) el('polyline', { points: pts(line), fill: 'none', stroke: css('--muted'), 'stroke-width': 0.8 }, svg)

    const colour = kind => css(kind === 'rope' ? '--rope' : kind === 'snubber' ? '--snubber' : '--chain')
    const override = r.state === 'lifting' ? css('--alarm') : r.state === 'taut' ? css('--warn') : null
    for (const sec of state.sections || []) {
      if (sec.bottom.length > 1 && sec.bottom[1][0] - sec.bottom[0][0] > 1e-3) {
        el('polyline', { points: pts(sec.bottom), fill: 'none', stroke: sec.kind === 'chain' ? css('--bottom-chain') : colour(sec.kind), 'stroke-width': 3 }, svg)
      }
    }
    for (const sec of state.sections || []) {
      if (sec.hanging.length < 2) continue
      el('polyline', {
        points: pts(sec.hanging),
        fill: 'none',
        stroke: override && sec.kind !== 'snubber' ? override : colour(sec.kind),
        'stroke-width': 2,
        'stroke-linejoin': 'round',
        'stroke-dasharray': r.state === 'taut' ? '5 4' : ''
      }, svg)
    }
    if (sn.loaded && sn.loopPoints) {
      el('polyline', { points: pts(sn.loopPoints), fill: 'none', stroke: css('--chain'), 'stroke-width': 1.5 }, svg)
    }
    el('circle', { cx: px(rollerX), cy: py(rollerY), r: 2.5, fill: css('--accent') }, svg)
    // anchor
    el('path', { d: `M${px(0) - 6},${py(0) - 1} L${px(0) + 2},${py(0) - 1} M${px(0) - 6},${py(0) - 1} l-3,-4`, stroke: css('--chain'), 'stroke-width': 1.5, fill: 'none', 'stroke-linecap': 'round' }, svg)
  }

  // ---------------------------------------------------------------- views

  function render () {
    card.innerHTML = ''
    card.className = view === 'status' ? 'status' : ''
    if (error) { html('div', 'msg', error, card); return }
    if (!state) { html('div', 'msg', 'Anchor catenary…', card); return }
    const r = state.result
    if (!r) {
      html('div', 'msg', state.missing && state.missing.length ? 'Waiting for ' + state.missing[0].replace(/ \(.*\)$/, '') : 'No anchor', card)
      return
    }
    const s = summary(state)
    const lift = r.state === 'taut' ? '' : s.margin >= 0 ? `lifts +${s.margin.toFixed(1)} m` : 'past lift'

    if (view === 'status') {
      html('div', 'state ' + s.cls, s.text, card)
      const big = html('div', 'big', undefined, card)
      big.textContent = fin(r.onBottom) ? r.onBottom.toFixed(0) : '–'
      html('small', '', ' m', big)
      html('div', 'muted', r.state === 'lifting' ? 'nothing on bottom' : 'on the bottom', card)
      html('div', s.cls === 'ok' ? 'muted' : 'state ' + s.cls, lift, card)
      return
    }

    const top = html('div', 'top', undefined, card)
    html('span', 'state ' + s.cls, s.text, top)
    html('span', 'muted', lift, top)
    const svg = document.createElementNS(NS, 'svg')
    svg.id = 'side'
    card.appendChild(svg)
    if (view === 'profile-large') {
      const dl = html('dl', 'nums', undefined, card)
      const row = (k, v, cls) => { html('dt', '', k, dl); html('dd', cls || '', v, dl) }
      const sn = state.snubber || {}
      row('On the bottom', m(r.onBottom), r.state === 'lifting' ? 'alarm' : '')
      if (r.ropeOnBottom > 0) row('Rope on bottom', m(r.ropeOnBottom), 'warn')
      row('Rode out', m(state.inputs.rode, 0) + (fin(r.scope) ? `  ${r.scope.toFixed(1)}:1` : ''))
      row('Depth', m(state.depth.value))
      const pull = sn.loaded ? sn.tension : r.horizontalTension
      row(sn.loaded ? 'Snubber' : 'Pull', fin(pull) ? `${Math.round(pull / G)} kgf` : '–')
      row('Pull to lift', fin(r.liftTension) ? `${Math.round(r.liftTension / G)} kgf` : '–')
    }
    drawSide(svg)
  }

  // ------------------------------------------------------------- network

  async function poll () {
    try {
      const res = await fetch(APIS[api], { credentials: 'include' })
      if (res.status === 404 && api === 0) { api = 1; return poll() }
      if (res.status === 401 || res.status === 403) throw new Error('Log in to see the rode')
      if (res.status === 404) throw new Error('Anchor catenary plugin is not enabled')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      state = await res.json()
      error = null
    } catch (e) {
      error = e.message === 'Failed to fetch' ? 'No connection' : e.message
    }
    render()
  }

  // ----------------------------------------------------- plotter connection

  let scheme = null // the plotter's light/dark choice
  let night = false

  function applyTheme () {
    const theme = night ? 'night' : scheme
    if (theme) document.documentElement.dataset.theme = theme
    else delete document.documentElement.dataset.theme
    render()
  }

  PlotterBus.connect().then(async bus => {
    if (!bus) return
    if (['profile', 'profile-large', 'status'].includes(bus.context.id)) view = bus.context.id
    if (bus.has('display')) {
      const apply = d => {
        if (!d) return
        if (d.colorScheme === 'dark' || d.colorScheme === 'light') scheme = d.colorScheme
        if (fin(d.panelOpacity)) document.documentElement.style.setProperty('--opacity', d.panelOpacity)
        applyTheme()
      }
      try {
        apply(await bus.call('display.get'))
        await bus.on(['display.changed'], (name, d) => { if (name === 'display.changed') apply(d) })
      } catch (e) {}
    }
    // night mode wins over the light/dark scheme
    PlotterBus.followNightMode(bus, on => { night = on; applyTheme() })
    render()
  })

  window.addEventListener('resize', render)
  poll()
  setInterval(poll, 2000)
})()
