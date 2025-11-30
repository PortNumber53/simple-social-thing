import { useCallback, useEffect, useMemo, useState } from 'react';

export function useSelectionSet<TId extends string>(presentIds: TId[]) {
  const [selectedIds, setSelectedIds] = useState<Set<TId>>(() => new Set());

  const present = useMemo(() => new Set(presentIds), [presentIds]);

  useEffect(() => {
    // Prune selection as the dataset changes.
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<TId>();
      for (const id of prev) {
        if (present.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [present]);

  const selectedCount = selectedIds.size;

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const setSelected = useCallback((id: TId, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggle = useCallback((id: TId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const addMany = useCallback((ids: TId[]) => {
    if (ids.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  return { selectedIds, selectedCount, setSelected, toggle, addMany, clear, setSelectedIds } as const;
}
