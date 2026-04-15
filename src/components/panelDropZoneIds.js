const PANEL_DROP_ZONE_PREFIX = "pane-drop-zone:";
const PANEL_DROP_ZONES = new Set(["left", "right", "top", "bottom"]);

export function getPaneDropZoneId(tabId = "", paneId = "", zone = "") {
  const normalizedZone = PANEL_DROP_ZONES.has(zone) ? zone : "";
  if (!tabId || !paneId || !normalizedZone) return "";
  return `${PANEL_DROP_ZONE_PREFIX}${tabId}:${paneId}:${normalizedZone}`;
}

export function parsePaneDropZoneId(id = "") {
  const value = String(id ?? "");
  if (!value.startsWith(PANEL_DROP_ZONE_PREFIX)) {
    return { tabId: "", paneId: "", zone: "" };
  }

  const rawValue = value.slice(PANEL_DROP_ZONE_PREFIX.length);
  const firstDelimiter = rawValue.indexOf(":");
  const secondDelimiter = rawValue.indexOf(":", firstDelimiter + 1);
  if (firstDelimiter < 0 || secondDelimiter < 0) {
    return { tabId: "", paneId: "", zone: "" };
  }

  const tabId = rawValue.slice(0, firstDelimiter);
  const paneId = rawValue.slice(firstDelimiter + 1, secondDelimiter);
  const zoneValue = rawValue.slice(secondDelimiter + 1);
  const zone = PANEL_DROP_ZONES.has(zoneValue) ? zoneValue : "";
  if (!tabId || !paneId || !zone) {
    return { tabId: "", paneId: "", zone: "" };
  }

  return { tabId, paneId, zone };
}
