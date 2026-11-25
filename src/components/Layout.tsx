import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/Auth';
import { api } from '../lib/api';
import { cx } from '../lib/format';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const icon = (path: string) => (
  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
);

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: icon('M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z') },
      { to: '/transactions', label: 'Daily Transactions', icon: icon('M4 6h16M4 12h16M4 18h10') },
      { to: '/monthly', label: 'Monthly Finance', icon: icon('M7 4v3m10-3v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z') }
    ]
  },
  {
    group: 'Records',
    items: [
      { to: '/income', label: 'Income', icon: icon('M12 19V5m0 0-6 6m6-6 6 6') },
      { to: '/expenses', label: 'Expenses', icon: icon('M12 5v14m0 0 6-6m-6 6-6-6') },
      { to: '/lending', label: 'Lending', icon: icon('M4 12h11m0 0-4-4m4 4-4 4M18 4v16') },
      { to: '/borrowing', label: 'Borrowing', icon: icon('M20 12H9m0 0 4-4m-4 4 4 4M6 4v16') },
      { to: '/accounts', label: 'Accounts', icon: icon('M3 8h18M5 8V6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2M4 8v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8') }
    ]
  },
  {
    group: 'Insight',
    items: [
      { to: '/analytics', label: 'Analytics', icon: icon('M4 19h16M7 16V9m5 7V5m5 11v-5') },
      { to: '/reports', label: 'Reports', icon: icon('M8 4h6l4 4v12H8V4Zm6 0v4h4M10 13h6M10 17h4') }
    ]
  },
  {
    group: 'Configure',
    items: [
      { to: '/categories', label: 'Categories', icon: icon('M4 7h6l2 3h8M4 7v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-8l-2-3H5a1 1 0 0 0-1 1Z') },
      { to: '/settings', label: 'Settings', icon: icon('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 2h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z') }
    ]
  }
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('finora-theme');
    if (stored) return stored === 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('finora-theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const initials = useMemo(() => {
    const name = user?.name?.trim() || user?.email || '?';
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }, [user]);

  const toggleTheme = async () => {
    const next = !dark;
    setDark(next);
    try {
      await api.settings({ theme: next ? 'dark' : 'light' });
    } catch {
      /* theme preference is cosmetic; ignore sync failures */
    }
  };

  const logout = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {NAV.map((group) => (
        <div key={group.group}>
          <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">{group.group}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cx(
                      'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition',
                      isActive
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100'
                    )
                  }
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <button
        type="button"
        onClick={logout}
        className="mt-auto flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
      >
        {icon('M15 12H3m0 0 4-4m-4 4 4 4m6-11h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4')}
        Logout
      </button>
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-[#f5f7fb] dark:bg-[#070b14]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200/80 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/70 lg:flex">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white">F</span>
          <div>
            <p className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-50">Finora</p>
            <p className="text-[10px] uppercase tracking-widest text-slate-400">Personal finance</p>
          </div>
        </div>
        {nav}
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl dark:bg-slate-950">
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-sm font-bold text-white">F</span>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Finora</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close navigation">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M6.3 5.3 10 9l3.7-3.7 1.4 1.4L11.4 10l3.7 3.7-1.4 1.4L10 11.4l-3.7 3.7-1.4-1.4L8.6 10 4.9 6.7z" />
                </svg>
              </button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200/80 bg-white/85 px-4 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80 sm:px-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 lg:hidden"
              aria-label="Open navigation"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              </svg>
            </button>
            <div className="hidden sm:block">
              <p className="text-[11px] uppercase tracking-widest text-slate-400">Signed in as</p>
              <p className="text-[13px] font-medium text-slate-800 dark:text-slate-200">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle dark mode"
              className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {dark ? (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" strokeLinecap="round" />
                </svg>
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 py-1 pl-1 pr-3 dark:border-slate-700">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-900 text-[11px] font-semibold text-white dark:bg-brand-600">{initials}</span>
              <span className="max-w-[9rem] truncate text-[13px] font-medium text-slate-700 dark:text-slate-200">{user?.name}</span>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 sm:px-6 sm:py-6">{children}</main>

        <footer className="border-t border-slate-200/70 px-4 py-3 text-center text-[11px] text-slate-400 dark:border-slate-800 sm:px-6">
          Finora · Your financial data is private to your account. Amounts are stored as exact decimals.
        </footer>
      </div>
    </div>
  );
}
