import { createContext, useContext, useEffect, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../lib/auth';
import { fetchWorkspace, useData, type Workspace } from '../lib/data';
import { Icon, type IconName } from './icons';
import { Avatar, ErrorNote, Loading } from './ui';

type WorkspaceCtx = { w: Workspace; refresh: () => Promise<void> };
const Ctx = createContext<WorkspaceCtx | null>(null);

/** The shared snapshot of users, classes, quizzes and results that every admin page reads. */
export function useWorkspace() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWorkspace must be used inside the admin shell');
  return c;
}

type NavItem = { to: string; label: string; icon: IconName; group: string };
const NAV: NavItem[] = [
  { to: '/overview', label: 'Dashboard', icon: 'home', group: '' },
  { to: '/users', label: 'Users', icon: 'users', group: 'People' },
  { to: '/verification', label: 'Instructor applications', icon: 'shield', group: 'People' },
  { to: '/instructors', label: 'Instructors', icon: 'school', group: 'People' },
  { to: '/subjects', label: 'Subjects', icon: 'book', group: 'Academics' },
  { to: '/sections', label: 'Sections', icon: 'users', group: 'Academics' },
  { to: '/schedules', label: 'Schedules', icon: 'calendar', group: 'Academics' },
  { to: '/classes', label: 'Classes', icon: 'edit', group: 'Academics' },
  { to: '/reports', label: 'Reports', icon: 'chart', group: 'Reports' },
  { to: '/activity', label: 'Activity log', icon: 'activity', group: 'Reports' },
  { to: '/settings', label: 'Settings', icon: 'clock', group: 'System' },
];

export function Shell() {
  const { name, signOut } = useAuth();
  const { data, error, refresh } = useData(fetchWorkspace);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const current = NAV.find((n) => location.pathname.startsWith(n.to))?.label ?? 'Dashboard';
  const applicants = data?.instructorProfiles.filter((x) => x.status === 'pending').length ?? 0;
  const badge: Record<string, number> = { '/verification': applicants };

  useEffect(() => setOpen(false), [location.pathname]);
  // Browser tab shows which page is open (helps with several tabs and the back-button history).
  useEffect(() => {
    document.title = `${current} · CvSU CMS Admin`;
  }, [current]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/users?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className="shell">
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">
          <img src="/seal.png" alt="" />
          <div>
            <b>Cavite State University</b>
            <small>Classroom Management System</small>
          </div>
        </div>
        {[...new Set(NAV.map((n) => n.group))].map((g) => (
          <div key={g} className="nav-group">
            {g ? <div className="nav-label">{g}</div> : null}
            <nav className="nav">
              {NAV.filter((n) => n.group === g).map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                  <Icon name={n.icon} size={17} />
                  {n.label}
                  {badge[n.to] ? <span className="count">{badge[n.to]}</span> : null}
                </NavLink>
              ))}
            </nav>
          </div>
        ))}
        <button className="side-out" onClick={() => void signOut()}>
          <Icon name="logout" size={17} />
          Sign out
        </button>
      </aside>
      {open ? <div className="sidebar-backdrop" onClick={() => setOpen(false)} aria-hidden /> : null}

      <div className="main">
        <header className="topbar">
          <button className="btn btn-secondary btn-sm menu-btn" onClick={() => setOpen((v) => !v)} aria-label="Menu">
            <Icon name="menu" />
          </button>
          <div className="crumbs">
            <b>{current}</b>
          </div>
          <form className="search" onSubmit={search} role="search">
            <Icon name="search" size={16} />
            <input placeholder="Search users by name, email or student number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the workspace" />
          </form>
          <div className="me">
            <div className="who">
              <b>{name || 'Administrator'}</b>
              <small>Administrator</small>
            </div>
            <Avatar name={name || 'Admin'} />
          </div>
        </header>
        <main className="content">
          {error ? <ErrorNote message={`Couldn’t load the workspace: ${error}`} /> : null}
          {data ? (
            <Ctx.Provider value={{ w: data, refresh }}>
              <Outlet />
            </Ctx.Provider>
          ) : error ? null : (
            <Loading />
          )}
        </main>
      </div>
    </div>
  );
}
