import { useCallback } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import CanvasPanel from "./CanvasPanel/CanvasPanel";
import ExternalUiPanel from "./ExternalUiPanel/ExternalUiPanel";
import FilesystemPanel from "./FilesystemPanel/FilesystemPanel";
import PreviewPanel from "./PreviewPanel/PreviewPanel";
import PropertiesPanel from "./PropertiesPanel/PropertiesPanel";
import ScriptsPanel from "./ScriptsPanel/ScriptsPanel";
import TerminalPanel from "./TerminalPanel/TerminalPanel";
import { PaneHeaderActionsProvider } from "./paneHeaderActionsContext";
import styles from "./WorkspacePanelLayout.module.scss";

const DEFAULT_SPLIT_PERCENT = 50;
const DEFAULT_PANEL_MIN_SIZE = 10;
const LEGACY_PRIMARY_PANE_ID = "left";
const LEGACY_SECONDARY_PANE_ID = "right";

const PANEL_COMPONENTS = {
  Filesystem: FilesystemPanel,
  Terminal: TerminalPanel,
  Scripts: ScriptsPanel,
  Canvas: CanvasPanel,
  Properties: PropertiesPanel,
  Preview: PreviewPanel,
  "External UI": ExternalUiPanel,
};

function clampSplitPercent(nextSplit) {
  const splitNumber = Number(nextSplit);
  if (!Number.isFinite(splitNumber)) return DEFAULT_SPLIT_PERCENT;
  return Math.max(10, Math.min(90, splitNumber));
}

function getLayoutPaneId(node) {
  if (typeof node?.paneId === "string") return node.paneId;
  if (typeof node?.pane_id === "string") return node.pane_id;
  return "";
}

function createFallbackLayout(layout, paneStates) {
  const paneIds = Object.keys(paneStates ?? {});
  if (!paneIds.length) return null;
  if (paneIds.length === 1) {
    return {
      kind: "leaf",
      paneId: paneIds[0],
    };
  }

  const firstPaneId = paneIds.includes(LEGACY_PRIMARY_PANE_ID)
    ? LEGACY_PRIMARY_PANE_ID
    : paneIds[0];
  const secondPaneId = paneIds.includes(LEGACY_SECONDARY_PANE_ID)
    ? LEGACY_SECONDARY_PANE_ID
    : paneIds.find(paneId => paneId !== firstPaneId);

  if (!secondPaneId) return {
    kind: "leaf",
    paneId: firstPaneId,
  };

  return {
    kind: "split",
    axis: "row",
    ratio: clampSplitPercent(layout?.split),
    first: {
      kind: "leaf",
      paneId: firstPaneId,
    },
    second: {
      kind: "leaf",
      paneId: secondPaneId,
    },
  };
}

function getTabLayout(layout, paneStates) {
  if (layout?.kind === "leaf" || layout?.kind === "split") return layout;
  return createFallbackLayout(layout, paneStates);
}

function WorkspacePanelLayout({
  tab,
  cwdHint = "",
  onCurrentPathChange = undefined,
  onFilesystemStateChange = undefined,
  onTabSelectedFilesChange = undefined,
  onPanelTypeChange = undefined,
  onPaneActivate = undefined,
  onPaneSplit = undefined,
  onPaneClose = undefined,
}) {
  const paneStates = tab?.paneStates ?? {};
  const paneCount = Object.keys(paneStates).length;
  const tabLayout = getTabLayout(tab?.layout, paneStates);
  const tabId = tab?.tabId ?? "";
  const activePaneId = tab?.activePaneId ?? "";

  const renderPaneViewport = useCallback((paneId, nodePath) => {
    const paneState = paneStates[paneId];
    if (!paneState) return <div key={`missing-${nodePath}`} className={styles.paneViewport} />;

    const panelType = paneState?.panelType ?? "Filesystem";
    const PanelComponent = PANEL_COMPONENTS[panelType] ?? FilesystemPanel;
    const isActivePane = Boolean(activePaneId && paneId === activePaneId);
    const paneHeaderActions = {
      canClose: paneCount > 1,
      onSplitRight: () => onPaneSplit?.(tabId, paneId, "right"),
      onSplitDown: () => onPaneSplit?.(tabId, paneId, "bottom"),
      onClose: () => onPaneClose?.(tabId, paneId),
    };

    return <div
      key={paneState?.paneId ?? `${tabId || "tab"}-${paneId}`}
      className={`${styles.paneViewport} ${isActivePane ? styles.activePane : ""}`}
      data-pane-id={paneId}
      onPointerDownCapture={() => onPaneActivate?.(tabId, paneId)}
    >
      <PaneHeaderActionsProvider value={paneHeaderActions}>
        <PanelComponent
          tabId={tabId}
          paneId={paneId}
          pane={paneId}
          panelType={panelType}
          onPanelTypeChange={nextPanelType =>
            onPanelTypeChange?.(tabId, paneId, nextPanelType)
          }
          onCurrentPathChange={path => onCurrentPathChange?.(tabId, paneId, path)}
          onFilesystemStateChange={filesystemState =>
            onFilesystemStateChange?.(tabId, paneId, filesystemState)
          }
          onTabSelectedFilesChange={selectedFiles =>
            onTabSelectedFilesChange?.(tabId, selectedFiles)
          }
          filesystemState={paneState?.filesystemState}
          tabSelectedFiles={tab?.selectedFiles}
          cwdHint={cwdHint}
          terminalSessionId={paneState?.terminalSessionId ?? ""}
        />
      </PaneHeaderActionsProvider>
    </div>;
  }, [
    activePaneId,
    cwdHint,
    onCurrentPathChange,
    onPaneClose,
    onFilesystemStateChange,
    onPaneActivate,
    onPaneSplit,
    onPanelTypeChange,
    onTabSelectedFilesChange,
    paneCount,
    paneStates,
    tab?.selectedFiles,
    tabId,
  ]);

  const renderLayoutNode = useCallback((node, nodePath = "root") => {
    if (!node || typeof node !== "object") return null;

    if (node.kind === "leaf") {
      const paneId = getLayoutPaneId(node);
      if (!paneId) return null;
      return renderPaneViewport(paneId, nodePath);
    }

    if (node.kind !== "split") return null;

    const axis = node?.axis === "column" ? "column" : "row";
    const firstSize = clampSplitPercent(node?.ratio);
    const secondSize = 100 - firstSize;
    const orientation = axis === "row" ? "horizontal" : "vertical";
    const separatorClassName = axis === "row"
      ? `${styles.resizeHandle} ${styles.resizeHandleHorizontal}`
      : `${styles.resizeHandle} ${styles.resizeHandleVertical}`;

    return <Group orientation={orientation} className={styles.panelGroup}>
      <Panel defaultSize={firstSize} minSize={DEFAULT_PANEL_MIN_SIZE}>
        {renderLayoutNode(node.first, `${nodePath}-first`)}
      </Panel>
      <Separator className={separatorClassName} />
      <Panel defaultSize={secondSize} minSize={DEFAULT_PANEL_MIN_SIZE}>
        {renderLayoutNode(node.second, `${nodePath}-second`)}
      </Panel>
    </Group>;
  }, [renderPaneViewport]);

  if (!tabLayout) return <div className={styles.panelGroup} />;

  return renderLayoutNode(tabLayout);
}

export default WorkspacePanelLayout;
