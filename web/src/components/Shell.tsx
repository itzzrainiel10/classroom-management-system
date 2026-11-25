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
  { to: '/overview', label: 'Dashboard', icon: 'home', group: 'MANAGE' },
  { to: '/users', label: 'User Management', icon: 'users', group: 'MANAGE' },
  { to: '/verification', label: 'Instructor Verification', icon: 'shield', group: 'MANAGE' },
  { to: '/instructors', label: 'Instructor Management', icon: 'school', group: 'MANAGE' },
  { to: '/subjects', label: 'Subject Management', icon: 'book', group: 'ACADEMICS' },
  { to: '/sections', label: 'Section Management', icon: 'users', group: 'ACADEMICS' },
  { to: '/schedules', label: 'Schedule Management', icon: 'calendar', group: 'ACADEMICS' },
  { to: '/classes', label: 'Classes & enrollment', icon: 'edit', group: 'ACADEMICS' },
  { to: '/reports', label: 'Reports', icon: 'chart', group: 'INSIGHTS' },
  { to: '/activity', label: 'Activity log', icon: 'activity', group: 'INSIGHTS' },
  { to: '/settings', label: 'Settings', icon: 'clock', group: 'SYSTEM' },
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
            <b>CvSU / Classroom</b>
            <small>ADMIN WORKSPACE</small>
          </div>
        </div>
        {[...new Set(NAV.map((n) => n.group))].map((g) => (
          <div key={g} className="nav-group">
            <div className="nav-label">{g}</div>
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
        <div className="side-note">
          <b>One shared workspace</b>
          Mobile and web use the same class records.
        </div>
        <button className="side-out" onClick={() => void signOut()}>
          <Icon name="logout" size={17} />
          Sign out
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn btn-secondary btn-sm menu-btn" onClick={() => setOpen((v) => !v)} aria-label="Menu">
            <Icon name="menu" />
          </button>
          <div className="crumbs">
            Workspace&nbsp;&nbsp;/&nbsp;&nbsp;<b>{current}</b>
          </div>
          <form className="search" onSubmit={search} role="search">
            <Icon name="search" size={16} />
            <input placeholder="Search users by name, email or student number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the workspace" />
          </form>
          <div className="me">
            <div className="who">
              <b>{name || 'Administrator'}</b>
              <small>System administrator</small>
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
