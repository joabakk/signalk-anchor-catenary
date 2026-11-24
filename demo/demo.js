/*
 * Demo: runs the plugin against a simulated boat and serves the webapp, without
 * a Signal K server. The boat swings round the anchor and falls back in the
 * gusts, and the tide falls slowly.
 *
 *   npm run demo            then open http://localhost:3000/
 *                           and http://localhost:3000/widgets for the Freeboard-SK widgets
 *   PORT=8080 npm run demo  on another port
 *
 * The rode out, charted depth and snubber are set from the webapp, as on a boat
 * without a chain counter.
 */
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { move } = require('../lib/geometry')

const PORT = Number(process.env.PORT) || 3000
const PUBLIC = path.join(__dirname, '..', 'public')
// the plugin's routes, and the same API under the webapp path (api/ relative to the page)
const PREFIXES = ['/plugins/signalk-anchor-catenary', '/signalk-anchor-catenary/api', '/api']
const ANCHOR = { latitude: 59.9, longitude: 10.7 }

// --------------------------------------------------- mock Signal K server

const data = {}
const set = (p, v) => { data[p] = { value: v, timestamp: new Date().toISOString() } }
const app = {
  getSelfPath: p => data[p],
  getDataDirPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-catenary-demo-')),
  handleMessage () {},
  setPluginStatus (s) { console.log(new Date().toLocaleTimeString(), s) },
  error: console.error,
  debug () {}
}
const dataDir = app.getDataDirPath()
app.getDataDirPath = () => dataDir

set('navigation.anchor.position', ANCHOR)
set('environment.depth.belowSurface', 7)
set('environment.tide.heightNow', 1.2)
// a traditional double-ender: RS 21 Solli (Colin Archer, Larvik 1908)
set('design.length', { overall: 14.35 })
set('design.beam', 4.84)
set('design.draft', { maximum: 2.4 })

// ------------------------------------------------------------ the boat

let t = 0
function simulate () {
  t += 1
  const wind = 0.5 + 0.5 * Math.sin(t / 9) + 0.25 * Math.max(0, Math.sin(t / 2.3)) // 0 .. 1.25
  const distance = 38 + 11 * wind // GPS antenna from the anchor, m
  const direction = 200 * Math.PI / 180 + 0.35 * Math.sin(t / 13) // boat lies SSW of the anchor
  set('navigation.position', move(ANCHOR, distance * Math.sin(direction), distance * Math.cos(direction)))
  set('navigation.headingTrue', (direction + Math.PI) % (2 * Math.PI)) // bow towards the anchor
  set('environment.tide.heightNow', 1.2 - 0.0005 * t) // falling tide
}
simulate()

// ------------------------------------------------------------ the plugin

const plugin = require('..')(app)
plugin.start({
  interval: 1,
  rollerForward: 5,
  rollerHeight: 1.2,
  rodeSections: [{ material: 'chain', length: 50, weight: 2.2 }, { material: 'nylon', weight: 0.17 }],
  snubberLength: 6,
  snubberAft: 0.4,
  snubberHeight: 0.4,
  bowStyle: 'doubleEnder'
})
setInterval(simulate, 1000)

const routes = {}
plugin.registerWithRouter({
  use () {},
  get (p, h) { routes['GET ' + p] = h },
  post (p, h) { routes['POST ' + p] = h }
})
routes['POST /rode']({ body: { length: 50 } }, { status () { return this }, json () {} })

// ----------------------------------------------------------- web server

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' }

http.createServer((req, res) => {
  const url = req.url.split('?')[0]
  const prefix = PREFIXES.find(p => url.startsWith(p + '/'))
  if (prefix) {
    const handler = routes[req.method + ' ' + url.slice(prefix.length)]
    if (!handler) { res.statusCode = 404; return res.end() }
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      const r = {
        status (c) { res.statusCode = c; return r },
        json (j) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(j)) }
      }
      let body
      try { body = raw ? JSON.parse(raw) : {} } catch (e) { return r.status(400).json({ error: 'Invalid JSON' }) }
      handler({ body }, r)
    })
    return
  }
  const name = path.basename(url) || 'index.html'
  const file = name === 'widgets' ? path.join(__dirname, 'widgets.html') : path.join(PUBLIC, name === 'signalk-anchor-catenary' ? 'index.html' : name)
  fs.readFile(file, (e, b) => {
    if (e) { res.statusCode = 404; return res.end() }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream')
    res.end(b)
  })
}).listen(PORT, () => console.log(`Anchor catenary demo on http://localhost:${PORT}/ (widgets: http://localhost:${PORT}/widgets)`))

process.on('SIGINT', () => { plugin.stop(); process.exit(0) })
