import { useRemote } from '@/hooks/use-remote';
import { fetchClasses, fetchFeed, fetchQuizSummaries, fetchSchedules } from '@/lib/data';

async function fetchStudentHome() {
  const [classes, quizzes, feed, schedules] = await Promise.all([fetchClasses(), fetchQuizSummaries(), fetchFeed(), fetchSchedules()]);
  return { classes, quizzes, feed, schedules };
}

export type StudentHome = Awaited<ReturnType<typeof fetchStudentHome>>;

/** Everything the student side shows, cached together for offline use. */
export function useStudentHome() {
  return useRemote('student-home', fetchStudentHome);
}
