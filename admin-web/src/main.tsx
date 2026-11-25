import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { Toaster } from './components/toast';
import { Loading } from './components/ui';
import { AdminLayout } from './layouts/AdminLayout';
import ActivityLog from './pages/Activity';
import { ResetPassword, SignIn } from './pages/Auth';
import Classes from './pages/Classes';
import EditUser from './pages/EditUser';
import Instructors from './pages/Instructors';
import Overview from './pages/Overview';
import Reports from './pages/Reports';
import Schedules from './pages/Schedules';
import Sections from './pages/Sections';
import Settings from './pages/Settings';
import Subjects from './pages/Subjects';
import Users from './pages/Users';
import Verification from './pages/Verification';
import { AuthProvider, useAuth } from './services/auth';
import './styles.css';

/**
 * ADMIN WEB APP (http://localhost:5173). Administrators only.
 * The route guard is a convenience: the database checks the admin role on every request
 * (row-level security + admin-only functions), so typing a URL never grants access.
 */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, isAdmin } = useAuth();
  if (status === 'loading') return <Loading />;
  if (status !== 'signed-in' || !isAdmin) return <Navigate to="/admin/login" replace />;
  return children;
}

/** Old addresses (bookmarks, the Google sign-in return URL /overview) forward to /admin/… */
const LEGACY: Record<string, string> = { overview: 'dashboard', verification: 'instructor-verification', 'sign-in': 'login' };
function LegacyRedirect() {
  const { pathname, search } = useLocation();
  const [, first, ...rest] = pathname.split('/');
  return <Navigate to={`/admin/${[LEGACY[first] ?? first, ...rest].join('/')}${search}`} replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <Toaster />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/admin/login" element={<SignIn />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            element={
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            }>
            <Route path="/admin/dashboard" element={<Overview />} />
            <Route path="/admin/users" element={<Users />} />
            <Route path="/admin/users/:id" element={<EditUser />} />
            <Route path="/admin/students" element={<Users only="student" />} />
            <Route path="/admin/instructor-verification" element={<Verification />} />
            <Route path="/admin/instructors" element={<Instructors />} />
            <Route path="/admin/subjects" element={<Subjects />} />
            <Route path="/admin/sections" element={<Sections />} />
            <Route path="/admin/schedules" element={<Schedules />} />
            <Route path="/admin/classes" element={<Classes />} />
            <Route path="/admin/reports" element={<Reports />} />
            <Route path="/admin/activity" element={<ActivityLog />} />
            <Route path="/admin/settings" element={<Settings />} />
          </Route>
          {['overview', 'sign-in', 'users/*', 'verification', 'instructors', 'subjects', 'sections', 'schedules', 'classes', 'reports', 'activity', 'settings'].map((p) => (
            <Route key={p} path={`/${p}`} element={<LegacyRedirect />} />
          ))}
          <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
