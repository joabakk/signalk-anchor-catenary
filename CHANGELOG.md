# Changelog

## 0.1.1

- Night mode: the outline buttons (Night, Clear, Off) had black text on black and could not be read, also on MFDs.
- New screenshots in the README and the App Store: the webapp, the Freeboard-SK widgets, and phone width in night mode.

## 0.1.0

First release.

- Live shape of the anchor rode from the anchor and boat positions, heading, bow roller position and height, depth at
  the anchor (recorded at the drop and tide corrected) and rode out: rode on the bottom, touchdown point, angles at the
  anchor and roller, tensions, and the distance and pull at which the anchor starts to lift.
- Rode sections from the anchor end: chain of different sizes, or chain and nylon or polyester rope.
- Snubber: length, material and where it is made fast; hooked on from the webapp with the chain let out after hooking
  on, with a check that the slack loop reaches.
- Publishes `navigation.anchor.catenary.*` with metadata, and a warning notification when the rode lifts the anchor or
  the inputs disagree.
- Webapp with side and plan views, numbers in kgf and kN, inputs for rode out, charted depth and the snubber, and red
  night mode. The boat can be drawn as a modern yacht or as a traditional double-ender (hull and rig after the rescue
  boat RS 21 Solli, sails down), to scale, with only the water depth exaggerated.
- Freeboard-SK screen widgets (status, side view, side view with numbers) and a toolbar button that opens the webapp,
  through the `plotterExtensions` resource; they follow Freeboard's night mode.
- Works on B&G, Simrad and Lowrance MFDs through signalk-navico-embedder: API also under the webapp's own path, day and
  night from `?mode=`, no browser features the MFD's Chromium 69 lacks.
- `npm run demo` runs the plugin on a simulated boat without a Signal K server, with a Freeboard widget preview.
