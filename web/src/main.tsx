import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Shell } from './components/Shell';
import { Loading } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import ActivityLog from './pages/Activity';
import { ResetPassword, SignIn, Welcome } from './pages/Auth';
import Classes from './pages/Classes';
import EditUser from './pages/EditUser';
import Overview from './pages/Overview';
import Reports from './pages/Reports';
import Instructors from './pages/Instructors';
import Schedules from './pages/Schedules';
import Sections from './pages/Sections';
import Settings from './pages/Settings';
import Subjects from './pages/Subjects';
import Users from './pages/Users';
import Verification from './pages/Verification';
import './styles.css';

/** Workspace pages are for administrators only (the database enforces the same rule). */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, isAdmin } = useAuth();
  if (status === 'loading') return <Loading />;
  if (status !== 'signed-in' || !isAdmin) return <Navigate to="/sign-in" replace />;
  return children;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Welcome />} />
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            element={
              <RequireAdmin>
                <Shell />
              </RequireAdmin>
            }>
            <Route path="/overview" element={<Overview />} />
            <Route path="/users" element={<Users />} />
            <Route path="/users/:id" element={<EditUser />} />
            <Route path="/classes" element={<Classes />} />
            <Route path="/activity" element={<ActivityLog />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/verification" element={<Verification />} />
            <Route path="/instructors" element={<Instructors />} />
            <Route path="/subjects" element={<Subjects />} />
            <Route path="/sections" element={<Sections />} />
            <Route path="/schedules" element={<Schedules />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
