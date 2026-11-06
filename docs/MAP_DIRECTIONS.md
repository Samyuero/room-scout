# In-app road directions

Maps → select a school/place or use Locate me → select a dorm pin → Directions → Show route.

The primary action draws an OSRM road route in the existing Leaflet/OpenStreetMap view. It shows a blue route, start/destination dots, distance and estimated driving time. Dashed endpoint connectors link the exact selected pins to the nearest routable road. Focusing a dorm from its details or a listing search no longer replaces an existing campus/GPS starting point.

Without a starting point, the app asks the user to choose a campus or use Locate me. It never silently pretends the dorm is the origin. An explicitly selected default Opao origin is labeled as such when GPS is unavailable.

Before a route request, the user confirms that the two coordinates will be sent to the OSRM public route service. No account identifier, profile, request, review or document is transmitted. Routes are cached in memory for ten minutes (maximum 20 entries), not persisted as device-location history. Requests have a twelve-second timeout, per-device pacing and cancellation when the start/destination/account changes or the map unmounts. Failed/no-route responses leave the map usable with retry feedback.

Open in Google Maps is an optional external fallback. It supplies both the selected origin and the exact dorm destination via Google's directions URL; it does not replace the in-app map.

## Live GPS and route refresh

While Maps is focused and the app is in the foreground, a foreground-only Expo Location subscription updates the device marker. It uses the existing location permission; it does not automatically open a new permission prompt. Tap Locate me to request permission or retry. Poor/stale fixes are ignored and the last known marker is not presented as live.

Choose Locate me, select a dorm and accept Show route to enable movement-based routing. Updated coordinates are sent to OSRM only after that consent, with at least 25 m movement, accuracy within 50 m, and at least 15 seconds between automatic attempts. If refresh fails, the previous route remains visible with a warning. Clear route stops automatic route requests. Closing Maps or backgrounding the app stops GPS tracking and cancels pending routing. No background-location permission is required.

A selected school/place remains a fixed route origin even while the device marker moves. Switch to Locate me to route from the phone instead. Live updates adjust the road preview; this is not voice/turn-by-turn navigation, and the route and ETA still use the driving profile.

## Limits

- Driving route preview only: not walking directions, live traffic, live turn-by-turn navigation, or a guarantee that an entrance is accessible. Check local road conditions.
- The [OSRM demo server](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server) permits modest non-commercial use, with no availability guarantee. The client paces requests but cannot enforce a shared fleet-wide request cap. For a larger survey/public deployment, use a managed/self-hosted routing service rather than assuming the public demo scales with installations.
- Geometry is parsed from the [OSRM Route API](https://project-osrm.org/docs/v5.24.0/api/#route-service). The map remains Leaflet with OSM tiles; no new native dependency or paid Google API key is required.

Verification covers coordinate/privacy/cache/error/cancellation guards, map-origin regressions, simulated GPS movement, accuracy/staleness filtering, foreground/background cleanup and late subscription cleanup. Previous verification also included a public Mandaue route response and a sample-data browser walkthrough of the UCLM-to-dorm route. Physical Android walking/GPS behavior and the external Google Maps handoff still require a device smoke test before distributing an APK.
