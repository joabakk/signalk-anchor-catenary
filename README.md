# signalk-anchor-catenary

A Signal K server plugin and webapp that shows how your anchor rode is lying right now, while you are at anchor:

- how much chain (and rope) lies on the bottom, and where it leaves the bottom
- whether the rode is lifting the anchor shank, and at what angle
- the rode angle and tension at the bow roller or snubber, and the horizontal pull on the anchor
- how far the boat can fall back before the rode starts lifting the anchor, and the pull that takes

The rode can be all chain, chain of different sizes, or chain and rope, with or without a snubber.

![Side and plan view](docs/screenshot.png)

Anchor alarm plugins tell you when the boat has left its swinging circle. Scope calculators tell you how much chain to put out.
This plugin fills the gap between the two. From the anchor position, the boat's position and heading, and the water depth at the
anchor, it works out the shape the rode must be hanging in.

## How it works

The horizontal distance from the bow roller to the anchor, the height of the roller above the seabed and the rode out
fix the shape of the rode completely. Each section of the rode hangs in a [catenary](https://en.wikipedia.org/wiki/Catenary)
set by its own weight in water, with the same horizontal pull all along. The plugin solves for it and reports one of four states:

| State | Meaning |
|---|---|
| `slack` | The rode is long enough to hang straight down and lie all the way to the anchor. There is no horizontal pull. |
| `catenary` | Part of the rode lies on the bottom, and the rest hangs up to the boat. This is normal. |
| `lifting` | All the rode is off the bottom and pulls the anchor shank upwards. The anchor loses holding power. A warning notification is raised. |
| `taut` | The rode out is shorter than the straight line from the boat to the anchor. That's impossible, so the anchor position, rode length or depth is wrong. |

The tensions come from the rode's weight in water: steel loses about 13 % of its weight in sea water, nylon about 90 % and
polyester about 75 %. They are the static tensions needed to hold the boat where it is, not the snatch loads from waves or the boat
sheering about.

### Rode sections: chain sizes, chain and rope

By default the rode is all chain of the weight in the settings. If yours is not, list the sections under **Rode sections**,
starting at the anchor: for example 20 m of 12 mm chain and then 10 mm chain, or 15 m of chain and then nylon rope. Give each section
its material, length and weight in air; the last section needs no length, it runs to the boat whatever is out.

Rope weighs almost nothing in water, so it hangs nearly straight and gives very little catenary. With 15 m of chain and nylon above
it in 10 m of water, the boat goes from rope lying slack on the bottom to the anchor lifting in under a metre of fall-back. The webapp
shows how much rope lies on the bottom, where it can chafe. Floating rope (polypropylene, Dyneema) isn't modelled.

### Snubber

Set the snubber's length, material and where it is made fast (distance aft of the roller and height above the waterline) in the
settings. At anchor, hook it on, let out more chain until the snubber takes the load, and enter how much you let out in the
webapp (**Hook on**). The plugin then solves the chain from the anchor to the hook plus the snubber to its fitting, and checks that the
slack loop of chain from the hook to the roller is long enough to reach: if it isn't, the chain over the roller takes the load
and the webapp says so. The snubber is treated as a rope that doesn't stretch.

The snubber is taken off when you press **Off**, when the chain is hauled in past the hook, or when the anchor comes up.

### Water depth at the anchor, and the tide

The depth sounder measures the depth under the boat, which is up to 50 m from the anchor and can be quite different. The default
depth mode (`auto`) works like this:

1. When an anchor position appears (from [signalk-anchoralarm-plugin](https://www.npmjs.com/package/signalk-anchoralarm-plugin),
   [hoekens-anchor-alarm](https://www.npmjs.com/package/hoekens-anchor-alarm), WilhelmSK, Freeboard-SK or any other app that sets
   `navigation.anchor.position`), the plugin records the depth and the tide height at that moment.
2. From then on, the depth at the anchor = recorded depth − tide when recorded + tide now.
3. Without a tide value, the live sounder depth is used instead.

Any tide plugin that publishes `environment.tide.heightNow` works, for example
[signalk-tides-api](https://www.npmjs.com/package/signalk-tides-api) or [signalk-tides](https://www.npmjs.com/package/signalk-tides).

If you drop the anchor away from where the sounder was, press **Use depth here as depth at anchor** in the webapp when the
boat is over the anchor. Alternatively, set the depth mode to *charted depth* and enter the depth from the chart; the tide is
added to it.

The record is kept when the server restarts and cleared when the anchor position is set to `null` (anchor up).

## Inputs

| Input | Signal K path | |
|---|---|---|
| Anchor position | `navigation.anchor.position` | required |
| Boat position | `navigation.position` | required, position of the GPS antenna |
| Heading | `navigation.headingTrue`, else `navigation.headingMagnetic` + `navigation.magneticVariation` | needed when the roller is not at the antenna |
| Depth | `environment.depth.belowSurface`, else `belowTransducer` + `surfaceToTransducer` | configurable |
| Tide | `environment.tide.heightNow` | configurable, optional |
| Rode out | `navigation.anchor.rodeLength` | configurable; or enter it in the webapp |
| Roller position | setting, else `sensors.gps.fromBow` | metres forward (and to starboard) of the GPS antenna |
| Roller height | setting, else `design.bowAnchorRollerHeight` | above the waterline |
| Chain weight | setting | kg/m in air, for an all-chain rode |
| Rode sections | setting | material, length and kg/m in air of each section, from the anchor |
| Snubber | setting | length, material, kg/m, and where it is made fast; hooked on from the webapp |
| Boat | `design.length`, `design.beam` | for drawing; and a setting for the boat: modern yacht, or traditional double-ender (hull and rig drawn after RS 21 Solli, without bowsprit) |

Position, heading and depth older than 60 s (configurable) are ignored.

## Outputs

Published under `navigation.anchor.catenary`, in SI units with metadata:

`state`, `horizontalDistance`, `rollerHeightAboveSeabed`, `waterDepth`, `rodeLength`, `scope`, `chainOnBottom`,
`ropeOnBottom`, `suspendedLength`, `touchdownDistance`, `anchorAngle`, `rollerAngle`, `horizontalTension`, `rollerTension`,
`liftDistance`, `liftTension`, `bearingFromBow`, `snubberLoaded`, `snubberTension`.

When the snubber takes the load, distances, angles and tensions are measured at the snubber fitting instead of the roller.
`chainOnBottom` is all the rode on the bottom, rope included.

`notifications.navigation.anchor.catenary` goes to `warn` when the rode lifts the anchor or the inputs disagree,
and back to `normal` afterwards. This can be turned off.

## Webapp

Open **Anchor Catenary** from the server's Webapps menu, or go to `http://<server>:3000/signalk-anchor-catenary/`.

- **Side view**: the rode from the anchor to the roller, each section in its own colour (heavier chain thicker), and the snubber with
  its hook and the slack loop of chain. Chain lying on the bottom is drawn brown. The dashed line marks where the roller (or snubber
  fitting) would be when the anchor starts to lift. The water depth can be exaggerated; the boat and everything above the
  waterline are drawn to scale.
- **Plan view**: the boat and the rode from above. The ring shows how far the roller can go before the anchor lifts.
- **Numbers** for everything above, with tensions in kgf and kN.
- **Inputs**: enter the rode out if you have no chain counter, enter a charted depth, take the current depth as the depth at the
  anchor, or hook the snubber on and off.
- Red **night** mode.

Setting values from the webapp needs a logged-in user if the server has security turned on. On Signal K server 2.37 and later,
any logged-in user can read the webapp and read/write users can set values; older servers allow only admins.

## On B&G, Simrad and Lowrance MFDs

The webapp works on Navico chart plotters through
[signalk-navico-embedder](https://www.npmjs.com/package/signalk-navico-embedder), which shows Signal K web apps as tiles on
the MFD. Install that plugin, open its settings and enable **Anchor Catenary** in its app list.

- The MFD has no login of its own. Either turn on **Allow Read-Only Access** under **Security** in the Signal K admin, or
  give the embedder a token (its **Generate Authentication Token** button). With a read-only token or read-only access the
  MFD shows the rode; to set the rode out, the snubber or the charted depth from the MFD, the token needs read/write.
- The webapp follows the MFD's day and night mode (`?mode=day` / `?mode=night` in the page address).
- The plugin serves its API under the webapp's own path, `/signalk-anchor-catenary/api/`, as well as under `/plugins/`, so
  it is reachable through the embedder's proxy and readable with read-only access on any server version.
- The MFD's browser is Chromium 69; the webapp avoids the newer browser features the embedder can't rewrite.

Tested through signalk-navico-embedder 1.8.0's proxy on Signal K 2.37, not yet on an MFD.

## Freeboard-SK widgets

With [Freeboard-SK](https://www.npmjs.com/package/@signalk/freeboard-sk) 3.5 or later the plugin adds, through its
`plotterExtensions` resource:

- three **screen widgets** to place over the chart:
  - *Anchor rode: status* (1×1): state, rode on the bottom and the margin before the anchor lifts;
  - *Anchor rode: side view* (2×1): the rode from the anchor to the bow, with the lift-off line;
  - *Anchor rode: side view and numbers* (2×2): the same, with rode on the bottom, rode out and scope, depth, pull and the pull
    to lift the anchor.
- an **Anchor catenary** button on Freeboard's extension toolbar, which opens the full webapp in a floating window.

To place a widget, press and hold (or right-click) an empty spot in a corner of the chart, or at the middle of the top or bottom
edge, and pick it from the list. The widgets and the window follow Freeboard's night mode. In the widgets' side view the
water depth is stretched to fit; the boat is drawn to scale.

The plugin must be enabled for the widgets to appear. To see them without Freeboard, run `npm run demo` and open
http://localhost:3000/widgets.

## REST API

Under `/plugins/signalk-anchor-catenary`, and the same under `/signalk-anchor-catenary/api` (POSTs there must be sent as
`application/json`):

| | |
|---|---|
| `GET /state` | everything the webapp shows, including the rode profile as `[x, y]` points, per section in `sections` |
| `POST /rode` `{"length": 40}` | rode out in metres, `null` to clear |
| `POST /seabed` `{"depth": 6.5}` | charted depth at the anchor, `null` to clear |
| `POST /record` | take the current depth and tide as the depth at the anchor |
| `POST /snubber` `{"on": true, "loop": 6}` | snubber hooked on, then `loop` m more chain let out; `{"on": false}` to take it off |

## Limitations

- The seabed is taken as flat between the anchor and the boat.
- Rope and snubbers don't stretch in the model. In reality a nylon snubber or rode stretches several percent under load, so near
  `taut` the real tension is lower than the model can tell.
- Floating rope isn't modelled.
- Static: wave, sheer and current loads are not included. Use the lift distance and lift tension as margins, not as limits.

## Development

```bash
npm test
```

To try the webapp without a Signal K server or a boat:

```bash
npm run demo
```

Then open http://localhost:3000/, and http://localhost:3000/widgets for the Freeboard-SK widgets. The demo runs the plugin against a simulated boat that swings round the anchor and falls
back in the gusts, with 50 m of chain and then nylon, a 6 m snubber and a falling tide. Set the rode out and hook the snubber on
and off from the webapp. Use `PORT=8080 npm run demo` for another port.

## License

Apache-2.0
