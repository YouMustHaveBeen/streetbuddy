// core: messenger-independent logic (plate recognition, geocoding, area check,
// description templates, link building).
export { isInArea } from "./area";
export { district } from "./district";
export { reverseGeocode } from "./geocode";
export {
  addUserAddress,
  approveAllWalk,
  decideIncoming,
  deleteAddress,
  getAddress,
  moveIncomingAddresses,
  movePoint,
  nearestAddresses,
  nextIncoming,
  renameAddress,
} from "./directory";
export type { Decision } from "./directory";
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
export type { LoggedReport } from "./stats";
