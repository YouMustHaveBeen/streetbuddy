// The working district, loaded from config/area.geojson.
import areaText from "../../config/area.geojson";
import { parseArea } from "./area";

export const district = parseArea(JSON.parse(areaText));
