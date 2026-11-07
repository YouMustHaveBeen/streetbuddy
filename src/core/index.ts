// core: messenger-independent logic (plate recognition, geocoding, area check,
// description templates, link building).
export { isInArea } from "./area";
export { district } from "./district";
export { formAddress, reverseGeocode, withoutPostalDistrict } from "./geocode";
export {
  addUserAddress,
  approveAllFrom,
  decideIncoming,
  deleteAddress,
  getAddress,
  moveIncomingAddresses,
  movePoint,
  nearestAddresses,
  nextIncoming,
  renameAddress,
  sameTextDistance,
  setAddressKind,
  CHOOSABLE_KINDS,
} from "./directory";
export type { AddressKind, Decision } from "./directory";
export { shapeFromGeometry, shapeMiddle } from "./shapes";
export type { Defer } from "./geocode";
export { PLATE_MAX_LENGTH, recognizePlates } from "./plate";
export {
  buildDescription,
  buildDescriptionLines,
  buildRoadUserLine,
  buildLocation,
  buildReportLink,
  dublinDateTime,
  PARKING_OPTIONS,
  ROAD_USER_TYPES,
} from "./report";
export { checkForm } from "./formcheck";
export { disableBot, enableBot, getSwitchStatus, isBotEnabled, recordFormCheck } from "./switch";
export type { FormCheckOutcome } from "./switch";
export { DAY_MS, REQUEST_TIMEOUT_MS, sleep } from "./shared";
export { dublinDay, getHotspots, logReport, runNightlyStats } from "./stats";
export { getDirectoryItems, getReportPlaces, MAP_PERIODS } from "./maps";
export type { MapPeriod } from "./maps";
export type { Hotspot, LoggedReport } from "./stats";
