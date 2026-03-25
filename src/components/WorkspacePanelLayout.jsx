import { useCallback, useRef, useState } from "react";
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
const SPLIT_HANDLE_DRAG_THRESHOLD_PX = 8;

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

function getSplitAxis(node) {
  return node?.axis === "column" ? "column" : "row";
}

function getSegmentPanelId(splitGroupId, segmentIndex) {
  return `${splitGroupId}-segment-${segmentIndex}`;
}

function getPanelMinSizePercent(panelCount) {
  if (!Number.isFinite(panelCount) || panelCount <= 0) {
    return DEFAULT_PANEL_MIN_SIZE_PERCENT;
  }
  const dynamicMin = Math.floor(100 / panelCount);
  return Math.max(1, Math.min(DEFAULT_PANEL_MIN_SIZE_PERCENT, dynamicMin));
}

function getLayoutPanelSize(layoutByPanel, panelId) {
  if (!layoutByPanel || typeof layoutByPanel !== "object" || !panelId) return 0;
  const panelSize = Number(layoutByPanel[panelId]);
  if (!Number.isFinite(panelSize) || panelSize < 0) return 0;
  return panelSize;
}

function collectSameAxisSegments(node, nodePath, axis, output = []) {
  if (!node || typeof node !== "object") return output;

  if (node.kind === "split" && getSplitAxis(node) === axis) {
    collectSameAxisSegments(node.first, `${nodePath}-first`, axis, output);
    collectSameAxisSegments(node.second, `${nodePath}-second`, axis, output);
    return output;
  }

  output.push({ node, nodePath });
  return output;
}

function collectSameAxisSegmentSizes(node, axis, branchSize = 100, output = []) {
  if (!node || typeof node !== "object") return output;

  if (node.kind === "split" && getSplitAxis(node) === axis) {
    const firstRatio = clampSplitPercent(node.ratio) / 100;
    collectSameAxisSegmentSizes(node.first, axis, branchSize * firstRatio, output);
    collectSameAxisSegmentSizes(node.second, axis, branchSize * (1 - firstRatio), output);
    return output;
  }

  output.push(branchSize);
  return output;
}

function collectSameAxisSplitRatioUpdates(
  node,
  nodePath,
  axis,
  segmentSizesByPath,
  output = [],
) {
  if (!node || typeof node !== "object") return 0;

  if (node.kind === "split" && getSplitAxis(node) === axis) {
    const firstSize = collectSameAxisSplitRatioUpdates(
      node.first,
      `${nodePath}-first`,
      axis,
      segmentSizesByPath,
      output,
    );
    const secondSize = collectSameAxisSplitRatioUpdates(
      node.second,
      `${nodePath}-second`,
      axis,
      segmentSizesByPath,
      output,
    );
    const totalSize = firstSize + secondSize;
    if (totalSize > 0) {
      output.push({
        splitPath: nodePath,
        ratio: Math.round(clampSplitPercent((firstSize / totalSize) * 100)),
      });
    }
    return totalSize;
  }

  return Number(segmentSizesByPath[nodePath] ?? 0);
}

function formatPercent(value) {
  return `${clampSplitPercent(value)}%`;
}

function getSplitDirectionFromDelta(deltaX, deltaY) {
  return Math.abs(deltaX) >= Math.abs(deltaY) ? "right" : "bottom";
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
  const cornerDragStateRef = useRef(null);
  const [splitPreview, setSplitPreview] = useState(null);

  const handleCornerHandlePointerDown = useCallback((event, paneId) => {
    if (!paneId || !tabId) return;

    const pointerId = typeof event.pointerId === "number" ? event.pointerId : 0;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(pointerId);
    cornerDragStateRef.current = {
      pointerId,
      paneId,
      startX: event.clientX,
      startY: event.clientY,
    };
    setSplitPreview(null);
  }, [tabId]);

  const handleCornerHandlePointerMove = useCallback((event) => {
    const dragState = cornerDragStateRef.current;
    if (!dragState) return;
    if (typeof event.pointerId === "number" && event.pointerId !== dragState.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    const dragDistance = Math.hypot(deltaX, deltaY);

    if (dragDistance < SPLIT_HANDLE_DRAG_THRESHOLD_PX) {
      setSplitPreview(previousPreview => (previousPreview ? null : previousPreview));
      return;
    }

    const direction = getSplitDirectionFromDelta(deltaX, deltaY);
    setSplitPreview(previousPreview => {
      if (
        previousPreview?.paneId === dragState.paneId
        && previousPreview?.direction === direction
      ) {
        return previousPreview;
      }
      return {
        paneId: dragState.paneId,
        direction,
      };
    });
  }, []);

  const handleCornerHandlePointerUp = useCallback((event) => {
    const dragState = cornerDragStateRef.current;
    if (!dragState || !tabId) return;

    const pointerId = typeof event.pointerId === "number"
      ? event.pointerId
      : dragState.pointerId;
    if (pointerId !== dragState.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    const dragDistance = Math.hypot(deltaX, deltaY);
    if (dragDistance >= SPLIT_HANDLE_DRAG_THRESHOLD_PX) {
      const direction = getSplitDirectionFromDelta(deltaX, deltaY);
      onPaneSplit?.(tabId, dragState.paneId, direction);
    }

    event.currentTarget.releasePointerCapture?.(pointerId);
    cornerDragStateRef.current = null;
    setSplitPreview(null);
  }, [onPaneSplit, tabId]);

  const handleCornerHandlePointerCancel = useCallback((event) => {
    const dragState = cornerDragStateRef.current;
    const pointerId = typeof event.pointerId === "number" ? event.pointerId : null;
    if (dragState && pointerId === dragState.pointerId) {
      event.currentTarget.releasePointerCapture?.(pointerId);
      cornerDragStateRef.current = null;
      setSplitPreview(null);
    }
  }, []);

  const handleCornerHandleLostPointerCapture = useCallback(() => {
    cornerDragStateRef.current = null;
    setSplitPreview(null);
  }, []);

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
      {splitPreview?.paneId === paneId ? <div
        className={`${styles.splitPreview} ${
          splitPreview.direction === "right"
            ? styles.splitPreviewVertical
            : styles.splitPreviewHorizontal
        }`}
        data-testid={`split-preview-${paneId}`}
        data-direction={splitPreview.direction}
        aria-hidden="true"
      /> : null}
      <div className={styles.cornerHandles}>
        <button
          type="button"
          className={`${styles.cornerHandle} ${styles.cornerHandleTopLeft}`}
          aria-label="Split pane right from top-left corner"
          title="Drag to split pane"
          onPointerDown={event => handleCornerHandlePointerDown(event, paneId)}
          onPointerMove={handleCornerHandlePointerMove}
          onPointerUp={handleCornerHandlePointerUp}
          onPointerCancel={handleCornerHandlePointerCancel}
          onLostPointerCapture={handleCornerHandleLostPointerCapture}
        />
        <button
          type="button"
          className={`${styles.cornerHandle} ${styles.cornerHandleTopRight}`}
          aria-label="Split pane right"
          title="Drag to split pane (Alt+V / Alt+H)"
          onPointerDown={event => handleCornerHandlePointerDown(event, paneId)}
          onPointerMove={handleCornerHandlePointerMove}
          onPointerUp={handleCornerHandlePointerUp}
          onPointerCancel={handleCornerHandlePointerCancel}
          onLostPointerCapture={handleCornerHandleLostPointerCapture}
        />
        <button
          type="button"
          className={`${styles.cornerHandle} ${styles.cornerHandleBottomLeft}`}
          aria-label="Split pane down from bottom-left corner"
          title="Drag to split pane"
          onPointerDown={event => handleCornerHandlePointerDown(event, paneId)}
          onPointerMove={handleCornerHandlePointerMove}
          onPointerUp={handleCornerHandlePointerUp}
          onPointerCancel={handleCornerHandlePointerCancel}
          onLostPointerCapture={handleCornerHandleLostPointerCapture}
        />
        <button
          type="button"
          className={`${styles.cornerHandle} ${styles.cornerHandleBottomRight}`}
          aria-label="Split pane down"
          title="Drag to split pane (Alt+V / Alt+H)"
          onPointerDown={event => handleCornerHandlePointerDown(event, paneId)}
          onPointerMove={handleCornerHandlePointerMove}
          onPointerUp={handleCornerHandlePointerUp}
          onPointerCancel={handleCornerHandlePointerCancel}
          onLostPointerCapture={handleCornerHandleLostPointerCapture}
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
    handleCornerHandlePointerCancel,
    handleCornerHandlePointerDown,
    handleCornerHandlePointerMove,
    handleCornerHandlePointerUp,
    handleCornerHandleLostPointerCapture,
    onPaneDirtyStateChange,
    onFilesystemStateChange,
    onPaneActivate,
    onPaneSplit,
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
    const splitGroupId = getSplitGroupId(tabId, nodePath);
    const flatSegments = collectSameAxisSegments(node, nodePath, axis);
    const flatSegmentSizes = collectSameAxisSegmentSizes(node, axis);
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
      const defaultSize = formatPercent(flatSegmentSizes[index] ?? 0);

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
    >
      {groupChildren}
    </Group>;
  }, [onSplitRatioChange, renderPaneViewport, tabId]);

  if (!tabLayout) return <div className={styles.panelGroup} />;

  return renderLayoutNode(tabLayout);
}

export default WorkspacePanelLayout;
