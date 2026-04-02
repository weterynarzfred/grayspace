import { useCallback } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { PaneHeaderActionsProvider } from "./paneHeaderActionsContext";
import { PANEL_COMPONENTS } from "./panelTypes";
import usePaneSplitPreview from "./usePaneSplitPreview";
import {
  collectSameAxisSegmentsWithSizes,
  collectSameAxisSplitRatioUpdates,
  formatPercent,
  getLayoutPaneId,
  getLayoutPanelSize,
  getPanelMinSizePercent,
  getSegmentPanelId,
  getSplitAxis,
  getSplitGroupId,
  getTabLayout,
} from "./workspacePanelLayoutUtils";
import styles from "./WorkspacePanelLayout.module.scss";

const CORNER_HANDLES = [
  {
    id: "top-left",
    className: "cornerHandleTopLeft",
    ariaLabel: "Split pane right from top-left corner",
    title: "Drag to split pane",
  },
  {
    id: "top-right",
    className: "cornerHandleTopRight",
    ariaLabel: "Split pane right",
    title: "Drag to split pane (Alt+V / Alt+H)",
  },
  {
    id: "bottom-left",
    className: "cornerHandleBottomLeft",
    ariaLabel: "Split pane down from bottom-left corner",
    title: "Drag to split pane",
  },
  {
    id: "bottom-right",
    className: "cornerHandleBottomRight",
    ariaLabel: "Split pane down",
    title: "Drag to split pane (Alt+V / Alt+H)",
  },
];

function getSplitPreviewClassName(direction) {
  return `${styles.splitPreview} ${direction === "right"
    ? styles.splitPreviewVertical
    : styles.splitPreviewHorizontal
  }`;
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
  const splitContextKey = tab?.workspaceRoot ? "workspace" : "default";
  const activePaneId = tab?.activePaneId ?? "";
  const {
    splitPreview,
    handleCornerHandlePointerDown,
    handleCornerHandlePointerMove,
    handleCornerHandlePointerUp,
    handleCornerHandlePointerCancel,
    handleCornerHandleLostPointerCapture,
  } = usePaneSplitPreview({ tabId, onPaneSplit });

  const renderPaneViewport = useCallback((paneId, nodePath) => {
    const paneState = paneStates[paneId];
    if (!paneState) return <div key={`missing-${nodePath}`} className={styles.paneViewport} />;

    const panelType = paneState?.panelType ?? "Filesystem";
    const PanelComponent = PANEL_COMPONENTS[panelType] ?? PANEL_COMPONENTS.Filesystem;
    const isActivePane = Boolean(activePaneId && paneId === activePaneId);
    const paneHeaderActions = {
      canClose: paneCount > 1,
      onClose: () => onPaneClose?.(tabId, paneId),
      isActive: isActivePane,
    };

    return <div
      key={`${tabId || "tab"}::${paneState?.paneId ?? paneId}`}
      className={`${styles.paneViewport} ${isActivePane ? styles.activePane : ""}`}
      data-pane-id={paneId}
      data-pane-active={isActivePane ? "true" : "false"}
      onPointerEnter={() => onPaneActivate?.(tabId, paneId)}
    >
      {splitPreview?.paneId === paneId ? <div
        className={getSplitPreviewClassName(splitPreview.direction)}
        data-testid={`split-preview-${paneId}`}
        data-direction={splitPreview.direction}
        aria-hidden="true"
      /> : null}
      <div className={styles.cornerHandles}>
        {CORNER_HANDLES.map(handle => <button
          key={handle.id}
          type="button"
          className={`${styles.cornerHandle} ${styles[handle.className]}`}
          aria-label={handle.ariaLabel}
          title={handle.title}
          onPointerDown={event => handleCornerHandlePointerDown(event, paneId)}
          onPointerMove={handleCornerHandlePointerMove}
          onPointerUp={handleCornerHandlePointerUp}
          onPointerCancel={handleCornerHandlePointerCancel}
          onLostPointerCapture={handleCornerHandleLostPointerCapture}
        />)}
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
          tabWorkspaceRoot={tab?.workspaceRoot ?? ""}
          tabSelectedFiles={tab?.selectedFiles}
          cwdHint={cwdHint}
          terminalSessionId={paneState?.terminalSessionId ?? ""}
        />
      </PaneHeaderActionsProvider>
    </div>;
  }, [
    activePaneId,
    cwdHint,
    handleCornerHandleLostPointerCapture,
    handleCornerHandlePointerCancel,
    handleCornerHandlePointerDown,
    handleCornerHandlePointerMove,
    handleCornerHandlePointerUp,
    onCurrentPathChange,
    onFilesystemStateChange,
    onPaneActivate,
    onPaneClose,
    onPaneDirtyStateChange,
    onPanelTypeChange,
    onTabSelectedFilesChange,
    paneCount,
    paneStates,
    splitPreview,
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

    const axis = getSplitAxis(node);
    const orientation = axis === "row" ? "horizontal" : "vertical";
    const separatorClassName = axis === "row"
      ? `${styles.resizeHandle} ${styles.resizeHandleHorizontal}`
      : `${styles.resizeHandle} ${styles.resizeHandleVertical}`;
    const splitGroupId = getSplitGroupId(tabId, nodePath, splitContextKey);
    const flatSegments = collectSameAxisSegmentsWithSizes(node, nodePath, axis);
    const panelMinSizePercent = getPanelMinSizePercent(flatSegments.length);
    const handleLayoutChanged = (layoutByPanel) => {
      if (!onSplitRatioChange || !tabId) return;

      const segmentSizesByPath = {};
      flatSegments.forEach((segment, index) => {
        const panelId = getSegmentPanelId(splitGroupId, index);
        segmentSizesByPath[segment.nodePath] = getLayoutPanelSize(layoutByPanel, panelId);
      });

      const splitRatioUpdates = [];
      collectSameAxisSplitRatioUpdates(
        node,
        nodePath,
        axis,
        segmentSizesByPath,
        splitRatioUpdates,
      );

      splitRatioUpdates
        .sort((a, b) => a.splitPath.length - b.splitPath.length)
        .forEach(update => {
          onSplitRatioChange(tabId, update.splitPath, update.ratio);
        });
    };

    const groupChildren = [];
    flatSegments.forEach((segment, index) => {
      const panelId = getSegmentPanelId(splitGroupId, index);
      const defaultSize = formatPercent(segment.size ?? 0);

      groupChildren.push(
        <Panel
          key={panelId}
          id={panelId}
          defaultSize={defaultSize}
          minSize={formatPercent(panelMinSizePercent)}
        >
          {renderLayoutNode(segment.node, segment.nodePath)}
        </Panel>,
      );

      if (index < flatSegments.length - 1) {
        groupChildren.push(
          <Separator
            key={`${panelId}-separator`}
            className={separatorClassName}
          />,
        );
      }
    });

    return <Group
      key={splitGroupId}
      id={splitGroupId}
      orientation={orientation}
      className={styles.panelGroup}
      onLayoutChanged={handleLayoutChanged}
    >{groupChildren}</Group>;
  }, [onSplitRatioChange, renderPaneViewport, splitContextKey, tabId]);

  if (!tabLayout) return <div className={styles.panelGroup} />;

  return renderLayoutNode(tabLayout);
}

export default WorkspacePanelLayout;
