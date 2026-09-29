export type SortRule = { column: number; direction: "ascending" | "descending" };
export type GridSortValue = string | number;

const gridCollator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

export function sortGridIndexes(
  values: GridSortValue[][],
  indexes: ArrayLike<number>,
  rules: SortRule[],
) {
  const sorted = Array.from(indexes);
  sorted.sort((leftIndex, rightIndex) => {
    const left = values[leftIndex] ?? [];
    const right = values[rightIndex] ?? [];
    for (const rule of rules) {
      const comparison = gridCollator.compare(
        String(left[rule.column] ?? ""),
        String(right[rule.column] ?? ""),
      );
      if (comparison !== 0) return rule.direction === "ascending" ? comparison : -comparison;
    }
    return leftIndex - rightIndex;
  });
  return Uint32Array.from(sorted);
}

export function sortRuleKey(rules: SortRule[]) {
  return rules.map((rule) => `${rule.column}:${rule.direction}`).join("|");
}
