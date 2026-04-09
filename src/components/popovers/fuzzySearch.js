import UFuzzy from "@leeoniya/ufuzzy";

const fuzzyMatcher = new UFuzzy();

function toSearchableText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function fallbackMatchIndices(haystack, needle) {
  const normalizedNeedle = needle.toLocaleLowerCase();
  if (!normalizedNeedle) return [];

  const indices = [];
  haystack.forEach((text, index) => {
    if (text.toLocaleLowerCase().includes(normalizedNeedle)) indices.push(index);
  });
  return indices;
}

function mapResultIndices(searchResult, haystack, needle) {
  const [idxs, info, order] = searchResult;
  if (idxs == null) return fallbackMatchIndices(haystack, needle);
  if (idxs.length === 0) return [];
  if (!info || !order) return idxs;
  return order.map((orderIndex) => info.idx[orderIndex]);
}

export function fuzzyFilterEntries(entries = [], query = "", getSearchText) {
  const normalizedQuery = toSearchableText(query);
  if (!normalizedQuery) return entries;

  const resolveSearchText = typeof getSearchText === "function"
    ? getSearchText
    : (entry) => entry;
  const haystack = entries.map((entry) => toSearchableText(resolveSearchText(entry)));
  const directMatchIndices = fallbackMatchIndices(haystack, normalizedQuery);
  if (directMatchIndices.length > 0) {
    return directMatchIndices.map((index) => entries[index]);
  }

  const searchResult = fuzzyMatcher.search(haystack, normalizedQuery);
  const matchedIndices = mapResultIndices(searchResult, haystack, normalizedQuery);

  return matchedIndices.map((index) => entries[index]);
}
