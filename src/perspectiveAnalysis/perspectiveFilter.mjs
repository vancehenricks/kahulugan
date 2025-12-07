const AVAILABLE_PERSPECTIVES = ['prosecutor', 'defense', 'judge'];

export function filterPerspectives(perspectiveFilter) {
  if (!perspectiveFilter) {
    return AVAILABLE_PERSPECTIVES;
  }

  const filter = Array.isArray(perspectiveFilter)
    ? perspectiveFilter.map((p) => p.toLowerCase())
    : perspectiveFilter
        .toLowerCase()
        .split(',')
        .map((p) => p.trim());

  return AVAILABLE_PERSPECTIVES.filter((p) => filter.includes(p));
}
