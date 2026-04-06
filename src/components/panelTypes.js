import CanvasPanel from "./CanvasPanel/CanvasPanel";
import ExternalUiPanel from "./ExternalUiPanel/ExternalUiPanel";
import FilesystemPanel from "./FilesystemPanel/FilesystemPanel";
import PreviewPanel from "./PreviewPanel/PreviewPanel";
import PropertiesPanel from "./PropertiesPanel/PropertiesPanel";
import ScriptsPanel from "./ScriptsPanel/ScriptsPanel";
import SettingsPanel from "./SettingsPanel/SettingsPanel";
import TerminalPanel from "./TerminalPanel/TerminalPanel";

export const PANELS = [
  { id: "Filesystem", label: "Filesystem", component: FilesystemPanel },
  { id: "Terminal", label: "Terminal", component: TerminalPanel },
  { id: "Scripts", label: "Scripts", component: ScriptsPanel },
  { id: "Canvas", label: "Canvas", component: CanvasPanel },
  { id: "Properties", label: "Properties", component: PropertiesPanel },
  { id: "Preview", label: "Preview", component: PreviewPanel },
  { id: "Settings", label: "Settings", component: SettingsPanel },
  { id: "External UI", label: "External UI", component: ExternalUiPanel },
];

export const PANEL_TYPES = PANELS.map(({ id, label }) => ({
  value: id,
  label,
}));

export const PANEL_COMPONENTS = Object.fromEntries(
  PANELS.map(({ id, component }) => [id, component]),
);
