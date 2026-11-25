import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export default function AuthShell({
  title,
  subtitle,
  children,
  footer
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f5f7fb] px-4 py-10 dark:bg-[#070b14]">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-brand-500/15 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-base font-bold text-white">F</span>
          <div>
            <p className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">Finora</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Personal finance manager</p>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_10px_40px_-24px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-slate-900/80 sm:p-7">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{title}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
          <div className="mt-5">{children}</div>
        </div>
        {footer ? <div className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">{footer}</div> : null}
        <p className="mt-6 text-center text-[11px] text-slate-400">
          <Link to="/login" className="hover:text-slate-600 dark:hover:text-slate-200">
            Secure session · exact decimal accounting
          </Link>
        </p>
      </div>
    </div>
  );
}
