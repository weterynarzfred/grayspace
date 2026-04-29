import { useDroppable } from "@dnd-kit/core";
import { useCallback, useMemo, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { getDraggedPathsFromDndEvent } from "./dndEventPaths";
import { PaneHeaderActionsProvider } from "./paneHeaderActionsContext";
import { parsePaneDropZoneId, getPaneDropZoneId } from "./panelDropZoneIds";
import { PANEL_COMPONENTS } from "./panelTypes";
import { usePanelsDndHandlers } from "./PanelsDndLayer";
import usePaneSplitPreview from "./usePaneSplitPreview";
import { parsePreviewTabDropId } from "./PreviewPanel/previewTabDndIds";
import { isSamePath } from "../utils/pathWatch";
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

const PANE_DROP_ZONE_DIRECTION = Object.freeze({
  left: "left",
  right: "right",
  top: "top",
  bottom: "bottom",
});
const PREVIEW_TOP_DROP_ZONE_INSET_PX = 23;

function normalizeDraggedPaths(event) {
  return getDraggedPathsFromDndEvent(event);
}

function resolveDragMetadata(event) {
  const activeData = event?.active?.data?.current ?? {};
  const sourceKind = typeof activeData.kind === "string" ? activeData.kind : "";
  const sourcePaneId = typeof activeData.sourcePreviewPaneId === "string"
    ? activeData.sourcePreviewPaneId
    : (typeof activeData.sourcePaneId === "string" ? activeData.sourcePaneId : "");
  const sourcePath = typeof activeData.sourcePreviewTabPath === "string"
    ? activeData.sourcePreviewTabPath
    : (typeof activeData.sourcePath === "string" ? activeData.sourcePath : "");
  const dragPaths = normalizeDraggedPaths(event);

  return {
    sourceKind,
    sourcePaneId,
    sourcePath,
    dragPaths,
  };
}

function resolvePanelTypeForPane(paneStates, paneId) {
  const requestedPanelType = paneStates?.[paneId]?.panelType ?? "Filesystem";
  return PANEL_COMPONENTS[requestedPanelType] ? requestedPanelType : "Filesystem";
}

function PaneDropZones({
  tabId = "",
  paneId = "",
  isEnabled = false,
  topInsetPx = 0,
}) {
  const resolvedTopInsetPx = Number.isFinite(topInsetPx) && topInsetPx > 0
    ? topInsetPx
    : 0;
  const dropZonesStyle = resolvedTopInsetPx > 0
    ? { "--pane-drop-zone-top-inset-px": `${resolvedTopInsetPx}px` }
    : undefined;
  const leftDropZoneId = useMemo(
    () => getPaneDropZoneId(tabId, paneId, "left"),
    [tabId, paneId],
  );
  const rightDropZoneId = useMemo(
    () => getPaneDropZoneId(tabId, paneId, "right"),
    [tabId, paneId],
  );
  const topDropZoneId = useMemo(
    () => getPaneDropZoneId(tabId, paneId, "top"),
    [tabId, paneId],
  );
  const bottomDropZoneId = useMemo(
    () => getPaneDropZoneId(tabId, paneId, "bottom"),
    [tabId, paneId],
  );

  const { isOver: isOverLeft, setNodeRef: setLeftNodeRef } = useDroppable({
    id: leftDropZoneId,
    disabled: !isEnabled,
    data: {
      kind: "pane-drop-zone",
      tabId,
      paneId,
      zone: "left",
    },
  });
  const { isOver: isOverRight, setNodeRef: setRightNodeRef } = useDroppable({
    id: rightDropZoneId,
    disabled: !isEnabled,
    data: {
      kind: "pane-drop-zone",
      tabId,
      paneId,
      zone: "right",
    },
  });
  const { isOver: isOverTop, setNodeRef: setTopNodeRef } = useDroppable({
    id: topDropZoneId,
    disabled: !isEnabled,
    data: {
      kind: "pane-drop-zone",
      tabId,
      paneId,
      zone: "top",
    },
  });
  const { isOver: isOverBottom, setNodeRef: setBottomNodeRef } = useDroppable({
    id: bottomDropZoneId,
    disabled: !isEnabled,
    data: {
      kind: "pane-drop-zone",
      tabId,
      paneId,
      zone: "bottom",
    },
  });

  return <div
    className={`${styles.paneDropZones} ${isEnabled ? styles.paneDropZonesVisible : ""}`}
    aria-hidden="true"
    style={dropZonesStyle}
  >
    <span
      ref={setLeftNodeRef}
      className={`${styles.paneDropZone} ${styles.paneDropZoneLeft} ${isOverLeft ? styles.paneDropZoneActive : ""}`}
    />
    <span
      ref={setRightNodeRef}
      className={`${styles.paneDropZone} ${styles.paneDropZoneRight} ${isOverRight ? styles.paneDropZoneActive : ""}`}
    />
    <span
      ref={setTopNodeRef}
      className={`${styles.paneDropZone} ${styles.paneDropZoneTop} ${isOverTop ? styles.paneDropZoneActive : ""}`}
    />
    <span
      ref={setBottomNodeRef}
      className={`${styles.paneDropZone} ${styles.paneDropZoneBottom} ${isOverBottom ? styles.paneDropZoneActive : ""}`}
    />
    <span className={styles.paneDropZoneCenter} />
  </div>;
}

function getSplitPreviewClassName(direction) {
  return `${styles.splitPreview} ${direction === "right"
    ? styles.splitPreviewVertical
    : styles.splitPreviewHorizontal
    }`;
}

function getWorkspaceLayoutKey(workspaceRoot = "") {
  const normalizedWorkspaceRoot = typeof workspaceRoot === "string"
    ? workspaceRoot.trim()
    : "";
  if (!normalizedWorkspaceRoot) return "default";
  return `workspace:${encodeURIComponent(normalizedWorkspaceRoot.toLowerCase())}`;
}

function WorkspacePanelLayout({
  tab,
  previewPaneStateById = {},
  primaryFilesystemPaneId = "",
  cwdHint = "",
  recentFoldersEntries = [],
  recentFoldersLoading = false,
  onOpenFolderInCurrentTab = undefined,
  onCurrentPathChange = undefined,
  onFilesystemStateChange = undefined,
  onTabSelectedFilesChange = undefined,
  onPanelTypeChange = undefined,
  onPaneActivate = undefined,
  onPaneSplit = undefined,
  onPaneClose = undefined,
  onPaneDirtyStateChange = undefined,
  onSplitRatioChange = undefined,
  onOpenPreviewPath = undefined,
  onActivatePreviewTab = undefined,
  onClosePreviewTab = undefined,
  onUpdatePreviewTab = undefined,
  onSplitPaneWithPanelType = undefined,
  onMovePreviewTabs = undefined,
}) {
  const paneStates = tab?.paneStates ?? {};
  const paneCount = Object.keys(paneStates).length;
  const tabLayout = getTabLayout(tab?.layout);
  const tabId = tab?.tabId ?? "";
  const splitContextKey = getWorkspaceLayoutKey(tab?.workspaceRoot);
  const activePaneId = tab?.activePaneId ?? "";
  const [panelDragState, setPanelDragState] = useState({
    sourceKind: "",
    sourcePaneId: "",
    sourcePath: "",
    dragPaths: [],
  });
  const hasDraggedPaths = panelDragState.dragPaths.length > 0;
  const {
    splitPreview,
    handleCornerHandlePointerDown,
    handleCornerHandlePointerMove,
    handleCornerHandlePointerUp,
    handleCornerHandlePointerCancel,
    handleCornerHandleLostPointerCapture,
  } = usePaneSplitPreview({ tabId, onPaneSplit });

  usePanelsDndHandlers({
    onDragStart: (event) => {
      const nextDragMetadata = resolveDragMetadata(event);
      setPanelDragState(nextDragMetadata);
      if (
        nextDragMetadata.sourceKind === "preview-tab"
        && nextDragMetadata.sourcePaneId
        && nextDragMetadata.sourcePath
      ) {
        onUpdatePreviewTab?.(
          tabId,
          nextDragMetadata.sourcePaneId,
          nextDragMetadata.sourcePath,
          { isEphemeral: false },
        );
      }
    },
    onDragCancel: () => {
      setPanelDragState({
        sourceKind: "",
        sourcePaneId: "",
        sourcePath: "",
        dragPaths: [],
      });
    },
    onDragEnd: async (event) => {
      const dragMetadata = resolveDragMetadata(event);
      const resetDragState = () => {
        setPanelDragState({
          sourceKind: "",
          sourcePaneId: "",
          sourcePath: "",
          dragPaths: [],
        });
      };
      try {
        if (dragMetadata.dragPaths.length === 0) return;

        const overId = String(event?.over?.id ?? "");
        const paneDropZone = parsePaneDropZoneId(overId);
        if (paneDropZone.tabId === tabId && paneDropZone.paneId && paneDropZone.zone) {
          const splitDirection = PANE_DROP_ZONE_DIRECTION[paneDropZone.zone] ?? "";
          if (splitDirection && typeof onSplitPaneWithPanelType === "function") {
            try {
              const splitResult = await onSplitPaneWithPanelType(
                tabId,
                paneDropZone.paneId,
                splitDirection,
                "Preview",
              );
              const newPaneId = typeof splitResult?.newPaneId === "string"
                ? splitResult.newPaneId
                : "";
              if (newPaneId) {
                if (dragMetadata.sourceKind === "preview-tab") {
                  onMovePreviewTabs?.(
                    tabId,
                    dragMetadata.sourcePaneId,
                    newPaneId,
                    dragMetadata.dragPaths,
                    { insert: "append", pinTabs: true },
                  );
                } else {
                  dragMetadata.dragPaths.forEach((path) => {
                    onOpenPreviewPath?.(tabId, newPaneId, path, { openMode: "pinned" });
                  });
                }
              }
            } catch {
              // Workspace actions surface split errors to the user.
            }
          }
          return;
        }

        const previewTabDrop = parsePreviewTabDropId(overId);
        if (previewTabDrop.paneId) {
          const isDroppingOnSamePreviewTab = previewTabDrop.kind === "tab"
            && dragMetadata.dragPaths.length === 1
            && isSamePath(previewTabDrop.path, dragMetadata.dragPaths[0]);
          if (isDroppingOnSamePreviewTab) return;
          if (dragMetadata.sourceKind === "preview-tab") {
            onMovePreviewTabs?.(
              tabId,
              dragMetadata.sourcePaneId,
              previewTabDrop.paneId,
              dragMetadata.dragPaths,
              {
                insert: previewTabDrop.kind === "bar" ? "append" : "at-target",
                targetPath: previewTabDrop.path,
                targetSide: previewTabDrop.side,
                pinTabs: true,
              },
            );
          } else {
            dragMetadata.dragPaths.forEach((path) => {
              onOpenPreviewPath?.(tabId, previewTabDrop.paneId, path, { openMode: "pinned" });
            });
          }
          return;
        }

        const overData = event?.over?.data?.current ?? {};
        const overPaneId = typeof overData.paneId === "string" ? overData.paneId : "";
        const overKind = typeof overData.kind === "string" ? overData.kind : "";
        if (
          dragMetadata.sourceKind === "preview-tab"
          && overKind === "preview"
          && overPaneId
        ) {
          onMovePreviewTabs?.(
            tabId,
            dragMetadata.sourcePaneId,
            overPaneId,
            dragMetadata.dragPaths,
            { insert: "append", pinTabs: true },
          );
        }
      } finally {
        resetDragState();
      }
    },
  });

  const renderPaneViewport = useCallback((paneId, nodePath) => {
    const paneState = paneStates[paneId];
    if (!paneState) return <div key={`missing-${nodePath}`} className={styles.paneViewport} />;

    const panelType = resolvePanelTypeForPane(paneStates, paneId);
    const isPrimaryFilesystemPane = panelType === "Filesystem"
      && paneId === primaryFilesystemPaneId;
    const arePaneDropZonesEnabled = hasDraggedPaths && panelType !== "Filesystem";
    const paneDropZoneTopInsetPx = panelType === "Preview"
      ? PREVIEW_TOP_DROP_ZONE_INSET_PX
      : 0;
    const panelLabel = panelType === "Filesystem" && !isPrimaryFilesystemPane
      ? "Filesystem (sub)"
      : panelType;
    const PanelComponent = PANEL_COMPONENTS[panelType] ?? PANEL_COMPONENTS.Filesystem;
    const isActivePane = Boolean(activePaneId && paneId === activePaneId);
    const paneHeaderActions = {
      canClose: paneCount > 1,
      onClose: () => onPaneClose?.(tabId, paneId),
      isActive: isActivePane,
    };

    return <div
      key={`${tabId || "tab"}::${paneState?.paneId ?? paneId}::${splitContextKey}`}
      className={`${styles.paneViewport} ${isActivePane ? styles.activePane : ""}`}
      data-contextmenu-boundary="panel"
      data-context-kind="panel"
      data-context-id={paneId}
      data-context-label={panelLabel}
      data-context-panel-type={panelType}
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
      <PaneDropZones
        tabId={tabId}
        paneId={paneId}
        isEnabled={arePaneDropZonesEnabled}
        topInsetPx={paneDropZoneTopInsetPx}
      />
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
          key={`${tabId || "tab"}::${paneId}::${paneState?.terminalSessionId ?? ""}`}
          tabId={tabId}
          paneId={paneId}
          panelType={panelType}
          panelLabel={panelLabel}
          isPrimaryFilesystemPane={isPrimaryFilesystemPane}
          onPanelTypeChange={nextPanelType =>
            onPanelTypeChange?.(tabId, paneId, nextPanelType)
          }
          onCurrentPathChange={isPrimaryFilesystemPane
            ? path => onCurrentPathChange?.(tabId, paneId, path)
            : undefined}
          onFilesystemStateChange={filesystemState =>
            onFilesystemStateChange?.(tabId, paneId, filesystemState)
          }
          onTabSelectedFilesChange={selectedFiles =>
            onTabSelectedFilesChange?.(tabId, selectedFiles)
          }
          onPaneDirtyStateChange={dirtyState =>
            onPaneDirtyStateChange?.(tabId, paneId, dirtyState, panelType)
          }
          previewPaneState={previewPaneStateById?.[paneId]}
          onOpenPreviewPath={(path, options = {}) =>
            onOpenPreviewPath?.(tabId, paneId, path, options)
          }
          onActivatePreviewTab={path => onActivatePreviewTab?.(tabId, paneId, path)}
          onClosePreviewTab={path => onClosePreviewTab?.(tabId, paneId, path)}
          onUpdatePreviewTab={(path, patch = {}) =>
            onUpdatePreviewTab?.(tabId, paneId, path, patch)
          }
          filesystemState={paneState?.filesystemState}
          tabWorkspaceRoot={tab?.workspaceRoot ?? ""}
          tabSelectedFiles={tab?.selectedFiles}
          cwdHint={cwdHint}
          recentFoldersEntries={recentFoldersEntries}
          recentFoldersLoading={recentFoldersLoading}
          onOpenFolderInCurrentTab={isPrimaryFilesystemPane
            ? onOpenFolderInCurrentTab
            : undefined}
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
    onOpenFolderInCurrentTab,
    onPaneActivate,
    onPaneClose,
    onPaneDirtyStateChange,
    onOpenPreviewPath,
    onActivatePreviewTab,
    onClosePreviewTab,
    onUpdatePreviewTab,
    onPanelTypeChange,
    onTabSelectedFilesChange,
    hasDraggedPaths,
    paneCount,
    paneStates,
    previewPaneStateById,
    primaryFilesystemPaneId,
    recentFoldersEntries,
    recentFoldersLoading,
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
        .toSorted((a, b) => a.splitPath.length - b.splitPath.length)
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
