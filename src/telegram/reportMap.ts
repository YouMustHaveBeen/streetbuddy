// The Report map screen: its text and the buttons of its periods.
export const MAP_PREFIX = "map:";
export const REPORT_MAP = "Report map";

export const REPORT_MAP_BUTTONS: { text: string; callback_data: string }[][] = [
  [
    { text: "Today", callback_data: `${MAP_PREFIX}today` },
    { text: "Week", callback_data: `${MAP_PREFIX}week` },
  ],
  [
    { text: "Last month", callback_data: `${MAP_PREFIX}last_month` },
    { text: "Month before", callback_data: `${MAP_PREFIX}month_before` },
  ],
];
