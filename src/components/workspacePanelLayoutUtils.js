const DEFAULT_SPLIT_PERCENT = 50;
const DEFAULT_PANEL_MIN_SIZE_PERCENT = 10;

export function clampSplitPercent(nextSplit) {
  const splitNumber = Number(nextSplit);
  if (!Number.isFinite(splitNumber)) return DEFAULT_SPLIT_PERCENT;
  return Math.max(10, Math.min(90, splitNumber));
}

export function getLayoutPaneId(node) {
  if (typeof node?.paneId === "string") return node.paneId;
  return "";
}

export function getTabLayout(layout) {
  if (layout?.kind === "leaf" || layout?.kind === "split") return layout;
  return null;
}

export function getSplitGroupId(tabId, nodePath) {
  const safeTabId = tabId || "tab";
  return `workspace-split-${safeTabId}-${nodePath}`;
}

export function getSplitAxis(node) {
  return node?.axis === "column" ? "column" : "row";
}

export function getSegmentPanelId(splitGroupId, segmentIndex) {
  return `${splitGroupId}-segment-${segmentIndex}`;
}

export function getPanelMinSizePercent(panelCount) {
  if (!Number.isFinite(panelCount) || panelCount <= 0) {
    return DEFAULT_PANEL_MIN_SIZE_PERCENT;
  }
  const dynamicMin = Math.floor(100 / panelCount);
  return Math.max(1, Math.min(DEFAULT_PANEL_MIN_SIZE_PERCENT, dynamicMin));
}

export function getLayoutPanelSize(layoutByPanel, panelId) {
  if (!layoutByPanel || typeof layoutByPanel !== "object" || !panelId) return 0;
  const panelSize = Number(layoutByPanel[panelId]);
  if (!Number.isFinite(panelSize) || panelSize < 0) return 0;
  return panelSize;
}

export function collectSameAxisSegmentsWithSizes(
  node,
  nodePath,
  axis,
  branchSize = 100,
  output = [],
) {
  if (!node || typeof node !== "object") return output;

  if (node.kind === "split" && getSplitAxis(node) === axis) {
    const firstRatio = clampSplitPercent(node.ratio) / 100;
    collectSameAxisSegmentsWithSizes(
      node.first,
      `${nodePath}-first`,
      axis,
      branchSize * firstRatio,
      output,
    );
    collectSameAxisSegmentsWithSizes(
      node.second,
      `${nodePath}-second`,
      axis,
      branchSize * (1 - firstRatio),
      output,
    );
    return output;
  }

  output.push({ node, nodePath, size: branchSize });
  return output;
}

export function collectSameAxisSplitRatioUpdates(
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

export function formatPercent(value) {
  return `${clampSplitPercent(value)}%`;
}

export function getSplitDirectionFromDelta(deltaX, deltaY) {
  return Math.abs(deltaX) >= Math.abs(deltaY) ? "right" : "bottom";
}
