/*
 * Minimal client for the Signal K plotter extension bus (plotterExt/1), used when
 * a page runs inside a chart plotter such as Freeboard-SK. Wire format:
 * https://www.npmjs.com/package/signalk-plotterext-bus
 *
 *   const bus = await PlotterBus.connect()   // null when not inside a plotter
 *   if (bus && bus.has('nightMode')) { ... await bus.call('nightMode.get') ... }
 *   bus.on(['nightMode.changed'], (name, params) => ...)
 */
window.PlotterBus = (function () {
  const BUS = 'plotterExt/1'

  function connect (timeoutMs = 4000) {
    if (window.parent === window) return Promise.resolve(null)
    return new Promise(resolve => {
      const pending = new Map()
      const listeners = []
      let seq = 0
      let done = false
      const origin = window.location.origin
      const post = msg => window.parent.postMessage({ bus: BUS, msg: Object.assign({ jsonrpc: '2.0' }, msg) }, origin)

      const call = (method, params) => new Promise((resolve, reject) => {
        const id = 'catenary-' + (++seq)
        pending.set(id, { resolve, reject })
        post(params === undefined ? { id, method } : { id, method, params })
        setTimeout(() => { if (pending.delete(id)) reject(new Error(method + ': timed out')) }, 5000)
      })

      const client = hs => ({
        context: hs.context || {},
        host: hs.host,
        has: c => (hs.capabilities || []).includes(c),
        call,
        on (patterns, fn) {
          listeners.push(fn)
          return call('events.subscribe', { patterns })
        }
      })

      window.addEventListener('message', ev => {
        if (ev.source !== window.parent || ev.origin !== origin) return
        const env = ev.data
        if (!env || env.bus !== BUS || !env.msg) return
        const m = env.msg
        if (m.method === 'bus.handshake') {
          if (done) return
          done = true
          clearInterval(ready)
          clearTimeout(giveUp)
          resolve(client(m.params || {}))
        } else if (m.method && m.id === undefined) {
          for (const fn of listeners) fn(m.method, m.params)
        } else if (m.method) {
          post({ id: m.id, error: { code: -32601, message: 'Method not found' } })
        } else if (pending.has(m.id)) {
          const p = pending.get(m.id)
          pending.delete(m.id)
          if (m.error) p.reject(Object.assign(new Error(m.error.message), m.error))
          else p.resolve(m.result)
        }
      })

      const ready = setInterval(() => post({ method: 'bus.ready' }), 250)
      post({ method: 'bus.ready' })
      const giveUp = setTimeout(() => {
        if (done) return
        done = true
        clearInterval(ready)
        resolve(null)
      }, timeoutMs)
    })
  }

  // Follow the plotter's night mode: calls apply(true/false) now and on every change
  async function followNightMode (bus, apply) {
    if (!bus || !bus.has('nightMode')) return
    try {
      const { enabled } = await bus.call('nightMode.get')
      apply(!!enabled)
      await bus.on(['nightMode.changed'], (name, p) => { if (name === 'nightMode.changed') apply(!!(p && p.enabled)) })
    } catch (e) {}
  }

  return { connect, followNightMode }
})()
