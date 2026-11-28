import { createContext, useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../services/auth';
import { fetchActivity, fetchWorkspace, useData, type Workspace } from '../services/data';
import { fmtDateTime } from '../services/format';
import { Icon, type IconName } from '../components/icons';
import { Avatar, Confirm, ErrorNote, Loading } from '../components/ui';
import { A11yMenuItem } from '../components/a11y';

type WorkspaceCtx = { w: Workspace; refresh: () => Promise<void> };
const Ctx = createContext<WorkspaceCtx | null>(null);

/** The shared snapshot of users, classes, quizzes and results that every admin page reads. */
export function useWorkspace() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWorkspace must be used inside the admin shell');
  return c;
}

type NavItem = { to: string; label: string; icon: IconName; group: string; /** other paths that belong to this item */ also?: string[] };
const NAV: NavItem[] = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: 'home', group: '' },
  { to: '/admin/instructor-verification', label: 'Applications & Renewals', icon: 'shield', group: 'People', also: ['/admin/renewals'] },
  { to: '/admin/instructors', label: 'Instructors', icon: 'school', group: 'People' },
  { to: '/admin/students', label: 'Students', icon: 'user', group: 'People' },
  { to: '/admin/subjects', label: 'Subjects', icon: 'book', group: 'Academics' },
  { to: '/admin/sections', label: 'Sections', icon: 'users', group: 'Academics' },
  { to: '/admin/rooms', label: 'Rooms', icon: 'home', group: 'Academics' },
  { to: '/admin/schedules', label: 'Schedules', icon: 'calendar', group: 'Academics' },
  { to: '/admin/classes', label: 'Classes', icon: 'edit', group: 'Academics' },
  { to: '/admin/reports', label: 'Reports', icon: 'chart', group: 'Reports' },
  { to: '/admin/activity', label: 'Activity log', icon: 'activity', group: 'Reports' },
  { to: '/admin/semesters', label: 'Semesters', icon: 'calendar', group: 'System' },
];

export function AdminLayout() {
  const { name, email, signOut } = useAuth();
  const [menu, setMenu] = useState<'profile' | 'bell' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [askSignOut, setAskSignOut] = useState(false);
  const { data, error, refresh } = useData(fetchWorkspace);
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('cvsu-cms-admin-sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('cvsu-cms-admin-sidebar', c ? 'expanded' : 'collapsed');
      } catch {
        /* storage unavailable: keep the choice for this visit only */
      }
      return !c;
    });
  const editingUser = location.pathname.startsWith('/admin/users/');
  const group = NAV.find((n) => location.pathname.startsWith(n.to) || !!n.also?.some((p) => location.pathname.startsWith(p)))?.group ?? (editingUser ? 'People' : '');
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const inItem = (n: NavItem) => location.pathname.startsWith(n.to) || !!n.also?.some((p) => location.pathname.startsWith(p));
  const current = NAV.find(inItem)?.label ?? (editingUser ? 'Edit user' : 'Dashboard');
  const applicants = data?.instructorProfiles.filter((x) => x.status === 'pending').length ?? 0;
  const badge: Record<string, number> = { '/admin/instructor-verification': applicants };
  const pending = data?.instructorProfiles.filter((x) => x.status === 'pending').sort((a, b) => b.submitted_at.localeCompare(a.submitted_at)) ?? [];
  // Recent activity is loaded only when the bell is opened (last 3 days).
  const bellOpen = menu === 'bell';
  const recent = useData(() => (bellOpen ? fetchActivity(new Date(Date.now() - 3 * 86400000).toISOString()) : Promise.resolve(null)), [bellOpen]);

  useEffect(() => {
    setOpen(false);
    setMenu(null);
  }, [location.pathname]);
  // Close the bell / profile menu on an outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);
  // Browser tab shows which page is open (helps with several tabs and the back-button history).
  useEffect(() => {
    document.title = `${current} · CvSU CMS Admin`;
  }, [current]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/admin/users?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`}>
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
                <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive || inItem(n) ? 'active' : '')} title={collapsed ? n.label : undefined}>
                  <Icon name={n.icon} size={18} />
                  <span className="label">{n.label}</span>
                  {badge[n.to] ? <span className="count">{badge[n.to]}</span> : null}
                  {badge[n.to] ? <span className="count-dot" /> : null}
                </NavLink>
              ))}
            </nav>
          </div>
        ))}
        {/* Sign out lives in the profile menu (top right), so the sidebar fits without scrolling. */}
        <button className="collapse-btn" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <Icon name="chevronsLeft" size={18} />
          <span>Collapse</span>
        </button>
      </aside>
      {open ? <div className="sidebar-backdrop" onClick={() => setOpen(false)} aria-hidden /> : null}

      <div className="main">
        <header className="topbar">
          <button className="btn btn-secondary btn-sm menu-btn" onClick={() => setOpen((v) => !v)} aria-label="Menu">
            <Icon name="menu" />
          </button>
          <nav className="crumbs" aria-label="Breadcrumb">
            <span className="trail">
              Admin <span className="sep">/</span> {group && group !== current ? (
                <>
                  {group} <span className="sep">/</span>
                </>
              ) : null}
            </span>
            <b>{current}</b>
          </nav>
          <form className="search" onSubmit={search} role="search">
            <Icon name="search" size={16} />
            <input placeholder="Search users by name, email or student number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the workspace" />
          </form>
          <div className="top-right" ref={menuRef}>
            <div className="profile-menu">
              <button
                className={`bell${bellOpen ? ' on' : ''}`}
                onClick={() => setMenu(bellOpen ? null : 'bell')}
                aria-haspopup="menu"
                aria-expanded={bellOpen}
                aria-label={pending.length ? `Notifications, ${pending.length} applications waiting` : 'Notifications'}>
                <Icon name="bell" size={19} />
                {pending.length ? <span className="bell-count">{pending.length > 9 ? '9+' : pending.length}</span> : null}
              </button>
              {bellOpen ? (
                <div className="dropdown notif-dropdown" role="menu">
                  <div className="dropdown-head">
                    <b>Needs your review</b>
                  </div>
                  {pending.length ? (
                    pending.slice(0, 4).map((a) => {
                      const p = data?.profiles.find((x) => x.id === a.user_id);
                      return (
                        <Link key={a.user_id} to="/admin/instructor-verification" className="notif unread" role="menuitem">
                          <span className="notif-dot" />
                          <span className="notif-text">
                            <b>Instructor application · {p?.full_name || p?.email || 'Applicant'}</b>
                            <small>{[a.employee_id, a.department].filter(Boolean).join(' · ') || 'Details not complete yet'}</small>
                            <time>Submitted {fmtDateTime(a.submitted_at)}</time>
                          </span>
                        </Link>
                      );
                    })
                  ) : (
                    <div className="notif-empty">No instructor applications waiting.</div>
                  )}
                  {pending.length > 4 ? (
                    <Link to="/admin/instructor-verification" className="notif-all" role="menuitem">
                      Review all {pending.length} applications
                    </Link>
                  ) : null}
                  <div className="dropdown-head dropdown-sub">
                    <b>Recent activity</b>
                  </div>
                  {!recent.data ? (
                    <div className="notif-empty">Loading…</div>
                  ) : recent.data.length ? (
                    recent.data.slice(0, 5).map((a) => (
                      <Link key={a.id} to="/admin/activity" className="notif" role="menuitem">
                        <span className="notif-dot" />
                        <span className="notif-text">
                          <b>
                            {a.action}
                            {a.target ? ` · ${a.target}` : ''}
                          </b>
                          <small>{a.actor_name}</small>
                          <time>{fmtDateTime(a.created_at)}</time>
                        </span>
                      </Link>
                    ))
                  ) : (
                    <div className="notif-empty">No activity in the last 3 days.</div>
                  )}
                  <Link to="/admin/activity" className="notif-all" role="menuitem">
                    Open activity log
                  </Link>
                </div>
              ) : null}
            </div>
            <div className="profile-menu">
              <button className="me" onClick={() => setMenu(menu === 'profile' ? null : 'profile')} aria-haspopup="menu" aria-expanded={menu === 'profile'}>
                <div className="who">
                  <b>{name || 'Administrator'}</b>
                  <small>Administrator</small>
                </div>
                <Avatar name={name || 'Admin'} />
                <Icon name="chevronDown" size={14} />
              </button>
              {menu === 'profile' ? (
                <div className="dropdown pm" role="menu">
                  <div className="pm-head">
                    <Avatar name={name || 'Admin'} />
                    <div className="pm-who">
                      <b>{name || 'Administrator'}</b>
                      <small>{email}</small>
                      <span className="pm-role">Administrator</span>
                    </div>
                  </div>
                  <div className="pm-group">
                    <span className="pm-label">Preferences</span>
                    <A11yMenuItem />
                  </div>
                  <div className="pm-group">
                    <span className="pm-label">Administration</span>
                    <Link to="/admin/semesters" role="menuitem">
                      <Icon name="calendar" size={16} /> Semesters
                    </Link>
                    <Link to="/admin/activity" role="menuitem">
                      <Icon name="activity" size={16} /> Activity log
                    </Link>
                  </div>
                  <div className="pm-foot">
                    <button
                      className="pm-signout"
                      role="menuitem"
                      onClick={() => {
                        setMenu(null);
                        setAskSignOut(true);
                      }}>
                      <Icon name="logout" size={16} /> Sign out
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
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
      {askSignOut ? (
        <Confirm
          title="Sign out?"
          body="Are you sure you want to sign out of the Admin website? You’ll need your email and password to sign in again."
          confirmLabel="Sign out"
          danger
          onClose={() => setAskSignOut(false)}
          onConfirm={async () => {
            await signOut();
          }}
        />
      ) : null}
    </div>
  );
}
