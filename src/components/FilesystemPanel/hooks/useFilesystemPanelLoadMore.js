import { useCallback, useEffect } from "react";

const LOAD_MORE_TRIGGER_MARGIN_ROWS = 40;
const LOAD_MORE_THRESHOLD_PX = 900;

export default function useFilesystemPanelLoadMore({
  panelRef,
  handlePanelListScroll,
  scheduleEntryWindowRecompute,
  isEntryWindowingEnabled,
  hasMoreEntries,
  isLoadingEntries,
  isLoadingMoreEntries,
  loadMoreEntries,
  isBrowsing,
  treeRowsCount,
  virtualEndIndex,
}) {
  const handlePanelScroll = useCallback((event) => {
    const scrollElement = event.currentTarget;
    handlePanelListScroll(event);
    scheduleEntryWindowRecompute();

    if (isEntryWindowingEnabled || !hasMoreEntries || isLoadingEntries || isLoadingMoreEntries) {
      return;
    }

    const remainingScrollPx =
      scrollElement.scrollHeight - (scrollElement.scrollTop + scrollElement.clientHeight);
    if (remainingScrollPx > LOAD_MORE_THRESHOLD_PX) return;
    loadMoreEntries();
  }, [
    handlePanelListScroll,
    scheduleEntryWindowRecompute,
    isEntryWindowingEnabled,
    hasMoreEntries,
    isLoadingEntries,
    isLoadingMoreEntries,
    loadMoreEntries,
  ]);

  useEffect(() => {
    if (!isBrowsing || isLoadingEntries || isLoadingMoreEntries || !hasMoreEntries) return;

    if (isEntryWindowingEnabled) {
      const loadMoreIndex = Math.max(0, treeRowsCount - LOAD_MORE_TRIGGER_MARGIN_ROWS);
      if (virtualEndIndex < loadMoreIndex) return;
      loadMoreEntries();
      return;
    }

    const panelList = panelRef.current;
    if (!panelList) return;
    const remainingScrollPx = panelList.scrollHeight - (panelList.scrollTop + panelList.clientHeight);
    if (remainingScrollPx > LOAD_MORE_THRESHOLD_PX) return;
    loadMoreEntries();
  }, [
    panelRef,
    isBrowsing,
    isLoadingEntries,
    isLoadingMoreEntries,
    hasMoreEntries,
    isEntryWindowingEnabled,
    treeRowsCount,
    virtualEndIndex,
    loadMoreEntries,
  ]);

  return { handlePanelScroll };
}

