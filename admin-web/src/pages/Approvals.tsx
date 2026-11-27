import { useLocation } from 'react-router-dom';

import { PageHeader } from '../components/ui';
import Renewals from './Renewals';

/**
 * Applications & Renewals — one list. New instructor applications and semester renewals are the
 * same step (especially after a semester ends), so they are approved together.
 * /admin/instructor-verification opens the Instructors list; /admin/renewals the Students list.
 */
export default function Approvals() {
  const { pathname } = useLocation();
  const instructors = pathname.startsWith('/admin/instructor-verification');
  return (
    <>
      <PageHeader title="Applications & Renewals" subtitle="New instructor applications and each semester's renewals, in one list." />
      <Renewals key={instructors ? 'i' : 's'} embedded initialKind={instructors ? 'instructor' : 'student'} />
    </>
  );
}
