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
const DEFAULT_PANEL_MIN_SIZE_PERCENT = 10;

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
  return "";
}

function getTabLayout(layout) {
  if (layout?.kind === "leaf" || layout?.kind === "split") return layout;
  return null;
}

function getSplitGroupId(tabId, nodePath) {
  const safeTabId = tabId || "tab";
  return `workspace-split-${safeTabId}-${nodePath}`;
}

function getSplitRatioFromLayout(layoutByPanel, firstPanelId) {
  if (!layoutByPanel || typeof layoutByPanel !== "object" || !firstPanelId) {
    return DEFAULT_SPLIT_PERCENT;
  }
  const firstSize = Number(layoutByPanel[firstPanelId]);
  return Math.round(clampSplitPercent(firstSize));
}

function formatPercent(value) {
  return `${clampSplitPercent(value)}%`;
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
  onPaneDirtyStateChange = undefined,
  onSplitRatioChange = undefined,
}) {
  const paneStates = tab?.paneStates ?? {};
  const paneCount = Object.keys(paneStates).length;
  const tabLayout = getTabLayout(tab?.layout);
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
      onClose: () => onPaneClose?.(tabId, paneId),
      isActive: isActivePane,
    };

    return <div
      key={paneState?.paneId ?? `${tabId || "tab"}-${paneId}`}
      className={`${styles.paneViewport} ${isActivePane ? styles.activePane : ""}`}
      data-pane-id={paneId}
      onPointerDownCapture={() => onPaneActivate?.(tabId, paneId)}
    >
      <div className={styles.cornerHandles}>
        <button
          type="button"
          className={`${styles.cornerHandle} ${styles.cornerHandleRight}`}
          aria-label="Split pane right"
          title="Split pane right (Alt+V)"
          onClick={() => onPaneSplit?.(tabId, paneId, "right")}
        />
        <button
          type="button"
          className={`${styles.cornerHandle} ${styles.cornerHandleBottom}`}
          aria-label="Split pane down"
          title="Split pane down (Alt+H)"
          onClick={() => onPaneSplit?.(tabId, paneId, "bottom")}
        />
      </div>
      <PaneHeaderActionsProvider value={paneHeaderActions}>
        <PanelComponent
          tabId={tabId}
          paneId={paneId}
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
          onPaneDirtyStateChange={dirtyState =>
            onPaneDirtyStateChange?.(tabId, paneId, dirtyState, panelType)
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
    onPaneDirtyStateChange,
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
    const splitGroupId = getSplitGroupId(tabId, nodePath);
    const firstPanelId = `${splitGroupId}-first`;
    const secondPanelId = `${splitGroupId}-second`;
    const handleLayoutChanged = (layoutByPanel) => {
      const nextRatio = getSplitRatioFromLayout(layoutByPanel, firstPanelId);
      onSplitRatioChange?.(tabId, nodePath, nextRatio);
    };

    return <Group
      key={splitGroupId}
      id={splitGroupId}
      orientation={orientation}
      className={styles.panelGroup}
      onLayoutChanged={handleLayoutChanged}
    >
      <Panel
        id={firstPanelId}
        defaultSize={formatPercent(firstSize)}
        minSize={formatPercent(DEFAULT_PANEL_MIN_SIZE_PERCENT)}
      >
        {renderLayoutNode(node.first, `${nodePath}-first`)}
      </Panel>
      <Separator className={separatorClassName} />
      <Panel
        id={secondPanelId}
        defaultSize={formatPercent(secondSize)}
        minSize={formatPercent(DEFAULT_PANEL_MIN_SIZE_PERCENT)}
      >
        {renderLayoutNode(node.second, `${nodePath}-second`)}
      </Panel>
    </Group>;
  }, [onSplitRatioChange, renderPaneViewport, tabId]);

  if (!tabLayout) return <div className={styles.panelGroup} />;

  return renderLayoutNode(tabLayout);
}

export default WorkspacePanelLayout;
