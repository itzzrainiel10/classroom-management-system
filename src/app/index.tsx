import { Redirect } from 'expo-router';

import { useAuth } from '@/lib/auth';

export default function Index() {
  const { status, role, application } = useAuth();
  if (status !== 'signed-in') return <Redirect href="/welcome" />;
  if (!role && application) return <Redirect href="/application" />;
  return <Redirect href={role === 'instructor' ? '/instructor' : '/student'} />;
}
