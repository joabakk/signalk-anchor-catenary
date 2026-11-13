/*
 * Horizontal geometry around the boat. Distances at anchor are at most a few
 * hundred metres, so a local flat-earth projection is plenty.
 */

const R = 6371008.8

// East/north offset in metres of `to` from `from` ({ latitude, longitude })
function offset (from, to) {
  const lat = (from.latitude + to.latitude) / 2 * Math.PI / 180
  return {
    east: (to.longitude - from.longitude) * Math.PI / 180 * R * Math.cos(lat),
    north: (to.latitude - from.latitude) * Math.PI / 180 * R
  }
}

// Move a position by east/north metres
function move (from, east, north) {
  const lat = from.latitude * Math.PI / 180
  return {
    latitude: from.latitude + north / R * 180 / Math.PI,
    longitude: from.longitude + east / (R * Math.cos(lat)) * 180 / Math.PI
  }
}

function normalizeAngle (a) {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a <= -Math.PI) a += 2 * Math.PI
  return a
}

/*
 * Where the roller is and how it relates to the anchor.
 *   antenna   GPS antenna position
 *   heading   true heading, rad
 *   forward   roller distance forward of the antenna, m
 *   starboard roller distance to starboard of the antenna, m
 *   anchor    anchor position
 */
function rollerToAnchor ({ antenna, heading, forward = 0, starboard = 0, anchor }) {
  const sin = Math.sin(heading)
  const cos = Math.cos(heading)
  const rollerEast = forward * sin + starboard * cos
  const rollerNorth = forward * cos - starboard * sin
  const roller = move(antenna, rollerEast, rollerNorth)
  const o = offset(roller, anchor)
  const bearing = Math.atan2(o.east, o.north)
  return {
    roller,
    distance: Math.hypot(o.east, o.north),
    bearing: (bearing + 2 * Math.PI) % (2 * Math.PI),
    relativeBearing: normalizeAngle(bearing - heading), // + = anchor to starboard of the bow
    antennaDistance: Math.hypot(...Object.values(offset(antenna, anchor)))
  }
}

module.exports = { offset, move, rollerToAnchor, normalizeAngle }
