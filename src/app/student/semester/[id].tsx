import { useLocalSearchParams } from 'expo-router';

import { Figures, SemesterHeader, StudentClassCard, useSemesterArchive } from '@/components/semester';
import { Caption, Empty, Loading, OfflineNote, Screen } from '@/components/ui';
import { pctOf, type StudentClassRecord } from '@/lib/archive';

/** One previous semester for a student: every class with grades, feedback, attendance and posts. Read-only. */
export default function StudentSemester() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const a = useSemesterArchive('student');
  const semester = a.semesters.find((s) => s.id === id);
  const classes = (a.records as StudentClassRecord[]).filter((r) => r.semester_id === id);

  const attempts = classes.flatMap((c) => c.data.quizzes.map((q) => pctOf(q.attempt))).filter((x): x is number => x != null);
  const avg = attempts.length ? Math.round(attempts.reduce((x, y) => x + y, 0) / attempts.length) : null;
  const att = classes.flatMap((c) => c.data.attendance);
  const rate = att.length ? Math.round((att.filter((x) => x.status === 'present').length / att.length) * 100) : null;

  return (
    <Screen onRefresh={a.refresh}>
      <OfflineNote show={a.offline} savedAt={a.savedAt} />
      <SemesterHeader semester={semester}>
        <Figures
          items={[
            ['Classes', String(classes.length)],
            ['Average score', avg == null ? '—' : `${avg}%`],
            ['Attendance', rate == null ? '—' : `${rate}%`],
          ]}
        />
      </SemesterHeader>
      {a.loading ? <Loading /> : null}
      {classes.length ? <Caption>Tap a class to see its grades, feedback, attendance and posts.</Caption> : null}
      {classes.map((r) => (
        <StudentClassCard key={r.id} r={r} />
      ))}
      {!a.loading && !classes.length ? <Empty icon="archive-outline" title="No records for this semester" body="You weren’t enrolled in any class that semester." /> : null}
    </Screen>
  );
}
