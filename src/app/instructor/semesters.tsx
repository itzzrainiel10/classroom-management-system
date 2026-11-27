import { SemesterList } from '@/components/semester';

/** Instructor → Previous Semesters: current semester and every past one (read-only). */
export default function InstructorSemesters() {
  return <SemesterList role="instructor" />;
}
