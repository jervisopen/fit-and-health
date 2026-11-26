import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateLogBody, UpdateLogBody } from "../../../../packages/shared/src/api.ts";
import { api } from "./api.ts";

export const keys = {
  diary: (date: string) => ["diary", date] as const,
  summary: (from: string, to: string) => ["summary", from, to] as const,
  food: (id: string) => ["food", id] as const,
  recent: (meal?: string) => ["recent", meal ?? ""] as const,
  custom: ["custom-foods"] as const,
  settings: ["settings"] as const,
};

export const useDiary = (date: string) => useQuery({ queryKey: keys.diary(date), queryFn: () => api.diary(date) });
export const useSummary = (from: string, to: string) =>
  useQuery({ queryKey: keys.summary(from, to), queryFn: () => api.summary(from, to) });
export const useFood = (id: string | null) =>
  useQuery({ queryKey: keys.food(id ?? ""), queryFn: () => api.food(id!), enabled: !!id, staleTime: 5 * 60_000 });
export const useSettings = (date: string) => useQuery({ queryKey: [...keys.settings, date], queryFn: () => api.settings(date) });

/** Anything that changes logs refreshes diaries, the date strip and recents. */
function useInvalidateLogs() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ["diary"] }),
    qc.invalidateQueries({ queryKey: ["summary"] }),
    qc.invalidateQueries({ queryKey: ["recent"] }),
  ]);
}

export function useCreateLog() {
  const invalidate = useInvalidateLogs();
  return useMutation({ mutationFn: (b: CreateLogBody) => api.createLog(b), onSuccess: invalidate });
}
export function useUpdateLog() {
  const invalidate = useInvalidateLogs();
  return useMutation({ mutationFn: ({ id, ...b }: UpdateLogBody & { id: string }) => api.updateLog(id, b), onSuccess: invalidate });
}
export function useDeleteLog() {
  const invalidate = useInvalidateLogs();
  return useMutation({ mutationFn: (id: string) => api.deleteLog(id), onSuccess: invalidate });
}
export function useCopyMeal() {
  const invalidate = useInvalidateLogs();
  return useMutation({ mutationFn: (v: Parameters<typeof api.copyMeal>) => api.copyMeal(...v), onSuccess: invalidate });
}
export function useInvalidateSettings() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: keys.settings }), qc.invalidateQueries({ queryKey: ["diary"] })]);
}
