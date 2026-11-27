import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../services/auth';
import { useData } from '../hooks/useData';
import { fetchInstructorData, markNotificationsRead, type InstructorData } from '../services/instructor';
import { fmtDateTime } from '../services/format';
import { Icon, type IconName } from '../components/icons';
import { Avatar, Confirm, ErrorNote, Loading } from '../components/ui';
import { A11yMenuItem } from '../components/a11y';

type Ctx = { d: InstructorData; refresh: () => Promise<void> };
const InstructorCtx = createContext<Ctx | null>(null);

/** The signed-in instructor's own data, shared by every Instructor Portal page. */
export function useInstructor() {
  const c = useContext(InstructorCtx);
  if (!c) throw new Error('useInstructor must be used inside the instructor portal');
  return c;
}

const NAV: { to: string; label: string; icon: IconName; group: string }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'home', group: '' },
  { to: '/subjects', label: 'My Subjects', icon: 'book', group: 'Teaching' },
  { to: '/sections', label: 'My Sections', icon: 'users', group: 'Teaching' },
  { to: '/schedule', label: 'My Teaching Schedule', icon: 'calendar', group: 'Teaching' },
  { to: '/weekly-schedule', label: 'Weekly Schedule', icon: 'clock', group: 'Teaching' },
  { to: '/classes', label: 'My Classes & Students', icon: 'users', group: 'Classwork' },
  { to: '/quizzes', label: 'Quizzes & Exams', icon: 'clipboard', group: 'Classwork' },
  { to: '/assignments', label: 'Assignments', icon: 'edit', group: 'Classwork' },
  { to: '/announcements', label: 'Announcements', icon: 'megaphone', group: 'Classwork' },
  { to: '/attendance', label: 'Attendance', icon: 'checkCircle', group: 'Classwork' },
  { to: '/omr', label: 'OMR Management', icon: 'clipboard', group: 'Classwork' },
  { to: '/results', label: 'Monitor Results', icon: 'chart', group: 'Classwork' },
];

/** Pages opened from the profile menu (top right) instead of the sidebar. */
const PROFILE_PAGES: Record<string, string> = { '/profile': 'My Profile', '/settings': 'Account Settings', '/notifications': 'Notifications' };

export function InstructorLayout() {
  const { name, email, signOut } = useAuth();
  const [menu, setMenu] = useState<'profile' | 'bell' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [askSignOut, setAskSignOut] = useState(false);
  const { data, error, refresh } = useData(fetchInstructorData);
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('cvsu-cms-instructor-sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('cvsu-cms-instructor-sidebar', c ? 'expanded' : 'collapsed');
      } catch {
        /* storage unavailable: keep the choice for this visit only */
      }
      return !c;
    });
  const group = NAV.find((n) => location.pathname.startsWith(n.to))?.group ?? '';
  const current = PROFILE_PAGES[location.pathname] ?? NAV.find((n) => location.pathname.startsWith(n.to))?.label ?? 'Dashboard';
  const unread = data?.notifications.filter((n) => !n.read_at).length ?? 0;

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
  useEffect(() => {
    document.title = `${current} · CvSU CMS Instructor`;
  }, [current]);

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`}>
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">
          <img src="/seal.png" alt="" />
          <div>
            <b>Cavite State University</b>
            <small>Instructor Portal</small>
          </div>
        </div>
        {[...new Set(NAV.map((n) => n.group))].map((g) => (
          <div key={g} className="nav-group">
            {g ? <div className="nav-label">{g}</div> : null}
            <nav className="nav">
              {NAV.filter((n) => n.group === g).map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')} title={collapsed ? n.label : undefined}>
                  <Icon name={n.icon} size={18} />
                  <span className="label">{n.label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        ))}
        {/* Sign out lives in the profile menu (top right). */}
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
              Instructor <span className="sep">/</span> {group && group !== current ? (
                <>
                  {group} <span className="sep">/</span>
                </>
              ) : null}
            </span>
            <b>{current}</b>
          </nav>
          <div className="top-right" ref={menuRef}>
            <div className="profile-menu">
              <button
                className={`bell${menu === 'bell' ? ' on' : ''}`}
                onClick={() => setMenu(menu === 'bell' ? null : 'bell')}
                aria-haspopup="menu"
                aria-expanded={menu === 'bell'}
                aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
                <Icon name="bell" size={19} />
                {unread ? <span className="bell-count">{unread > 9 ? '9+' : unread}</span> : null}
              </button>
              {menu === 'bell' ? (
                <div className="dropdown notif-dropdown" role="menu">
                  <div className="dropdown-head row" style={{ justifyContent: 'space-between' }}>
                    <b>Notifications</b>
                    {unread ? (
                      <button className="link mark-read" onClick={() => void markNotificationsRead().then(refresh)}>
                        Mark all as read
                      </button>
                    ) : null}
                  </div>
                  {data?.notifications.length ? (
                    data.notifications.slice(0, 6).map((n) => (
                      <Link key={n.id} to="/notifications" className={`notif${n.read_at ? '' : ' unread'}`} role="menuitem">
                        <span className="notif-dot" />
                        <span className="notif-text">
                          <b>{n.title}</b>
                          <small>{n.body}</small>
                          <time>{fmtDateTime(n.created_at)}</time>
                        </span>
                      </Link>
                    ))
                  ) : (
                    <div className="notif-empty">No notifications yet.</div>
                  )}
                  <Link to="/notifications" className="notif-all" role="menuitem">
                    View all notifications
                  </Link>
                </div>
              ) : null}
            </div>
            <div className="profile-menu">
            <button className="me" onClick={() => setMenu(menu === 'profile' ? null : 'profile')} aria-haspopup="menu" aria-expanded={menu === 'profile'}>
              <div className="who">
                <b>{name || 'Instructor'}</b>
                <small>Instructor</small>
              </div>
              <Avatar name={name || 'Instructor'} />
              <Icon name="chevronDown" size={14} />
            </button>
            {menu === 'profile' ? (
              <div className="dropdown pm" role="menu">
                <div className="pm-head">
                  <Avatar name={name || 'Instructor'} />
                  <div className="pm-who">
                    <b>{name || 'Instructor'}</b>
                    <small>{email}</small>
                    <span className="pm-role">Instructor</span>
                  </div>
                </div>
                <div className="pm-group">
                  <span className="pm-label">Account</span>
                  <Link to="/profile" role="menuitem">
                    <Icon name="user" size={16} /> My Profile
                  </Link>
                  <Link to="/settings" role="menuitem">
                    <Icon name="edit" size={16} /> Account Settings
                  </Link>
                </div>
                <div className="pm-group">
                  <span className="pm-label">Preferences</span>
                  <A11yMenuItem />
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
          {error ? <ErrorNote message={`Couldn’t load your data: ${error}`} /> : null}
          {data ? (
            <InstructorCtx.Provider value={{ d: data, refresh }}>
              <Outlet />
            </InstructorCtx.Provider>
          ) : error ? null : (
            <Loading />
          )}
        </main>
      </div>
      {askSignOut ? (
        <Confirm
          title="Sign out?"
          body="Are you sure you want to sign out of the Instructor website? You’ll need your email and password to sign in again."
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
