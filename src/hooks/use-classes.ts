import { useRemote } from '@/hooks/use-remote';
import { fetchClasses, type ClassSummary } from '@/lib/data';
import { pendingRows } from '@/lib/offline';

/** The signed-in user's classes, including ones created offline and not yet uploaded. */
export function useClasses() {
  return useRemote('classes', fetchClasses, async (list: ClassSummary[]) => {
    const pending = await pendingRows<ClassSummary>('classes');
    const ids = new Set(list.map((c) => c.id));
    return [...pending.filter((p) => !ids.has(p.id)).map((p) => ({ ...p, students: 0, quizzes: 0, assignments: 0 })), ...list];
  });
}
