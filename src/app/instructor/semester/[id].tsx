import { router, useLocalSearchParams, type Href } from 'expo-router';

import { MenuRow } from '@/components/menu-row';
import { Figures, SemesterHeader, useSemesterArchive } from '@/components/semester';
import { Empty, Loading, OfflineNote, Screen } from '@/components/ui';
import type { InstructorClassRecord } from '@/lib/archive';

/** One previous semester for an instructor: the classes they handled. Read-only. */
export default function InstructorSemester() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const a = useSemesterArchive('instructor');
  const semester = a.semesters.find((s) => s.id === id);
  const classes = (a.records as InstructorClassRecord[]).filter((r) => r.semester_id === id);
  const students = classes.reduce((n, c) => n + c.student_count, 0);
  const subjects = new Set(classes.map((c) => c.code)).size;

  return (
    <Screen onRefresh={a.refresh}>
      <OfflineNote show={a.offline} savedAt={a.savedAt} />
      <SemesterHeader semester={semester}>
        <Figures
          items={[
            ['Classes', String(classes.length)],
            ['Subjects', String(subjects)],
            ['Students', String(students)],
          ]}
        />
      </SemesterHeader>
      {a.loading ? <Loading /> : null}
      {classes.map((c) => (
        <MenuRow
          key={c.id}
          icon="people-outline"
          title={`${c.code} · ${c.section}`}
          body={`${c.title} · ${c.student_count} student${c.student_count === 1 ? '' : 's'}`}
          onPress={() => router.push(`/instructor/archived-class/${c.id}` as Href)}
        />
      ))}
      {!a.loading && !classes.length ? <Empty icon="archive-outline" title="No classes this semester" body="You didn’t handle any class that semester." /> : null}
    </Screen>
  );
}
