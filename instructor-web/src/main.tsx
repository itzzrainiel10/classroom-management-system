import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { Toaster } from './components/toast';
import { Loading } from './components/ui';
import { InstructorLayout } from './layouts/InstructorLayout';
import Attendance from './pages/Attendance';
import MyClasses from './pages/MyClasses';
import Omr from './pages/Omr';
import OmrPrint from './pages/OmrPrint';
import { ResetPassword, SignIn } from './pages/Auth';
import {
  InstructorClassSchedule,
  InstructorDashboard,
  InstructorNotifications,
  InstructorProfile,
  InstructorSchedule,
  InstructorSections,
  InstructorSettings,
  InstructorSubjects,
} from './pages/Portal';
import {
  InstructorAnnouncements,
  InstructorAssignments,
  InstructorQuizEditor,
  InstructorQuizResults,
  InstructorQuizzes,
  InstructorResults,
} from './pages/Teaching';
import { AuthProvider, useAuth } from './services/auth';
import { initPrefs } from './services/prefs';
import './styles.css';

initPrefs();

/**
 * INSTRUCTOR WEB APP (http://localhost:5174). Approved instructors only.
 * The route guard is a convenience: the database returns only the instructor's own records and
 * refuses every write outside their own classes (row-level security), whatever URL is typed.
 */
function RequireInstructor({ children }: { children: ReactNode }) {
  const { status, isInstructor } = useAuth();
  if (status === 'loading') return <Loading />;
  if (status !== 'signed-in' || !isInstructor) return <Navigate to="/login" replace />;
  return children;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <Toaster />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<SignIn />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/omr/print/:quizId"
            element={
              <RequireInstructor>
                <OmrPrint />
              </RequireInstructor>
            }
          />
          <Route
            element={
              <RequireInstructor>
                <InstructorLayout />
              </RequireInstructor>
            }>
            <Route path="/dashboard" element={<InstructorDashboard />} />
            <Route path="/profile" element={<InstructorProfile />} />
            <Route path="/subjects" element={<InstructorSubjects />} />
            <Route path="/sections" element={<InstructorSections />} />
            <Route path="/schedule" element={<InstructorSchedule />} />
            <Route path="/weekly-schedule" element={<InstructorClassSchedule />} />
            <Route path="/quizzes" element={<InstructorQuizzes />} />
            <Route path="/quizzes/:id" element={<InstructorQuizEditor />} />
            <Route path="/assignments" element={<InstructorAssignments />} />
            <Route path="/announcements" element={<InstructorAnnouncements />} />
            <Route path="/classes" element={<MyClasses />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/omr" element={<Omr />} />
            <Route path="/results" element={<InstructorResults />} />
            <Route path="/results/:id" element={<InstructorQuizResults />} />
            <Route path="/notifications" element={<InstructorNotifications />} />
            <Route path="/settings" element={<InstructorSettings />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
