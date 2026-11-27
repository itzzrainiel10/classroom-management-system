import { SemesterList } from '@/components/semester';

/** Student → My Semesters: current semester and every previous one (read-only). */
export default function StudentSemesters() {
  return <SemesterList role="student" />;
}
