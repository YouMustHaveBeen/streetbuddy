// The map pages served by the Worker: the report map and the address directory map, both on Mapbox.
import { MAP_PERIODS, district, getDirectoryItems, getReportPlaces } from "./core";
import type { MapPeriod } from "./core";
import type { Env } from "./env";
import { htmlResponse } from "./install";

export const REPORT_MAP_PATH = "/reportmap";
export const DIRECTORY_PATH = "/directory";

const MAPBOX_VERSION = "v3.33.0";
const MAP_STYLE = "mapbox://styles/mapbox/streets-v12";

const GREEN = "#bacf5a";
const VIOLET = "#b5a6eb";
const FUCHSIA = "#d946ef";
const OUTLINE = "#555555";

type MapEnv = Pick<Env, "DB" | "MAPBOX_TOKEN">;

const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g");
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g");

// JSON that can stand inside a script element.
const inlineJson = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(LINE_SEPARATOR, "\\u2028").replace(PARAGRAPH_SEPARATOR, "\\u2029");

// The border of the district as a closed line, and the rectangle around it.
function districtOutline(): { border: [number, number][]; bounds: [[number, number], [number, number]] } {
  const ring = district.ring;
  const lons = ring.map(([lon]) => lon);
  const lats = ring.map(([, lat]) => lat);
  return {
    border: [...ring, ring[0]],
    bounds: [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ],
  };
}

const STYLE = `  html, body, #map { margin: 0; height: 100%; }
  .place { min-width: 30px; height: 30px; padding: 0 4px; box-sizing: border-box; border: 2px solid ${OUTLINE}; border-radius: 15px;
    display: flex; align-items: center; justify-content: center; font: 600 14px system-ui, sans-serif; color: #222; cursor: pointer; }
  .popup-list { max-height: 40vh; overflow-y: auto; font: 14px/1.4 system-ui, sans-serif; color: #222; }`;

// Both pages draw the border of the district and fit the map to it; `script` adds the rest.
function mapPage(token: string, data: Record<string, unknown>, script: string): Response {
  const outline = districtOutline();
  return htmlResponse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StreetBuddy</title>
<link href="https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl.css" rel="stylesheet">
<style>
${STYLE}
</style>
</head>
<body>
<div id="map"></div>
<script src="https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl.js"></script>
<script>
(function () {
  "use strict";
  var DATA = ${inlineJson({ ...data, ...outline })};
  var GREEN = "${GREEN}", VIOLET = "${VIOLET}", FUCHSIA = "${FUCHSIA}", OUTLINE = "${OUTLINE}";
  mapboxgl.accessToken = ${inlineJson(token)};
  var map = new mapboxgl.Map({
    container: "map",
    style: "${MAP_STYLE}",
    bounds: DATA.bounds,
    fitBoundsOptions: { padding: 30 }
  });

  function textNode(lines) {
    var node = document.createElement("div");
    node.className = "popup-list";
    for (var i = 0; i < lines.length; i++) {
      var line = document.createElement("div");
      line.textContent = lines[i];
      node.appendChild(line);
    }
    return node;
  }

  // Adds a line with a dark edge under it.
  function addLine(id, source, filter, width, color) {
    map.addLayer({ id: id + "-edge", type: "line", source: source, filter: filter, paint: { "line-color": OUTLINE, "line-width": width + 2 } });
    map.addLayer({ id: id, type: "line", source: source, filter: filter, paint: { "line-color": color || GREEN, "line-width": width } });
  }

  map.on("load", function () {
    map.addSource("border", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: DATA.border } } });
    addLine("border", "border", ["all"], 3);
    ${script}
  });
})();
</script>
</body>
</html>`);
}

const REPORT_MAP_SCRIPT = `DATA.places.forEach(function (place) {
      var element = document.createElement("div");
      element.className = "place";
      element.style.background = place.facility ? FUCHSIA : VIOLET;
      element.textContent = (place.hotspot ? "🔥" : "") + place.dates.length;
      var popup = new mapboxgl.Popup({ offset: 18 }).setDOMContent(textNode(place.dates));
      new mapboxgl.Marker({ element: element }).setLngLat([place.lon, place.lat]).setPopup(popup).addTo(map);
    });`;

const DIRECTORY_SCRIPT = `var features = DATA.items.map(function (item) {
      return { type: "Feature", properties: { text: item.text, kind: item.kind }, geometry: item.geometry };
    });
    map.addSource("directory", { type: "geojson", data: { type: "FeatureCollection", features: features } });
    var isArea = ["==", ["geometry-type"], "Polygon"];
    var isLine = ["any", ["==", ["geometry-type"], "LineString"], ["==", ["geometry-type"], "MultiLineString"]];
    var isPoint = ["==", ["geometry-type"], "Point"];
    map.addLayer({ id: "areas", type: "fill", source: "directory", filter: isArea, paint: { "fill-color": VIOLET, "fill-opacity": 0.45 } });
    map.addLayer({ id: "area-borders", type: "line", source: "directory", filter: isArea, paint: { "line-color": OUTLINE, "line-width": 1.5 } });
    addLine("lines", "directory", isLine, 4, ["case", ["==", ["get", "kind"], "facility"], FUCHSIA, VIOLET]);
    map.addLayer({
      id: "points", type: "circle", source: "directory", filter: isPoint,
      paint: {
        "circle-radius": 7,
        "circle-color": ["case", ["==", ["get", "kind"], "facility"], FUCHSIA, VIOLET],
        "circle-stroke-color": OUTLINE,
        "circle-stroke-width": 1.5
      }
    });
    ["areas", "lines-edge", "points"].forEach(function (layer) {
      map.on("click", layer, function (event) {
        var properties = event.features[0].properties;
        new mapboxgl.Popup().setLngLat(event.lngLat).setDOMContent(textNode([properties.text])).addTo(map);
      });
      map.on("mouseenter", layer, function () { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layer, function () { map.getCanvas().style.cursor = ""; });
    });`;

// The period comes from the link; any other value gives no page.
export async function reportMapPage(env: MapEnv, period: string | null, now = Date.now()): Promise<Response> {
  const known = MAP_PERIODS.find((name): name is MapPeriod => name === period);
  if (!known) return new Response("Not Found", { status: 404 });
  const places = await getReportPlaces(env.DB, known, now);
  return mapPage(env.MAPBOX_TOKEN, { places }, REPORT_MAP_SCRIPT);
}

export async function directoryPage(env: MapEnv): Promise<Response> {
  const items = await getDirectoryItems(env.DB);
  return mapPage(env.MAPBOX_TOKEN, { items }, DIRECTORY_SCRIPT);
}
