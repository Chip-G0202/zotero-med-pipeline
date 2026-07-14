export function buildWritebackCollectionKeys({
  root,
  trashKey = "",
  worthy = null,
  monthKey = "",
  dateKey = "",
  sourceKeys = {},
  gradeKeys = {},
} = {}) {
  return [
    root?.key,
    trashKey,
    worthy?.key,
    monthKey,
    dateKey,
    ...Object.values(sourceKeys),
    ...Object.values(gradeKeys),
  ];
}
