// core: messenger-independent logic (plate recognition, geocoding, area check,
// description templates, link building).
export { AREA_MARGIN_M, isInArea, parseArea } from "./area";
export { district } from "./district";
export { reverseGeocode, searchAddress } from "./geocode";
export { PLATE_MAX_LENGTH, recognizePlates } from "./plate";
export {
  buildDescription,
  buildLocation,
  buildReportLink,
  dublinDateTime,
  PARKING_OPTIONS,
} from "./report";
export type { Area } from "./area";
export type { Place } from "./geocode";
export type { ParkingOption } from "./report";
export { checkForm } from "./formcheck";
export { disableBot, enableBot, getSwitchStatus, isBotEnabled, recordFormCheck } from "./switch";
export type { FormCheck } from "./formcheck";
export type { FormCheckOutcome } from "./switch";
