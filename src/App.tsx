import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import Layout from './components/Layout';
import { Loading, ToastProvider } from './components/ui';
import { useAuth } from './context/Auth';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Monthly from './pages/Monthly';
import Income from './pages/Income';
import Expenses from './pages/Expenses';
import Lending from './pages/Lending';
import Borrowing from './pages/Borrowing';
import Accounts from './pages/Accounts';
import Analytics from './pages/Analytics';
import Reports from './pages/Reports';
import Categories from './pages/Categories';
import Settings from './pages/Settings';

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f5f7fb] dark:bg-[#070b14]">
        <Loading label="Checking your session…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Layout>{children}</Layout>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f5f7fb] dark:bg-[#070b14]">
        <Loading label="Loading…" />
      </div>
    );
  }
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnly>
              <Login />
            </PublicOnly>
          }
        />
        <Route
          path="/register"
          element={
            <PublicOnly>
              <Register />
            </PublicOnly>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <PublicOnly>
              <ForgotPassword />
            </PublicOnly>
          }
        />
        <Route
          path="/reset-password"
          element={
            <PublicOnly>
              <ResetPassword />
            </PublicOnly>
          }
        />
        <Route
          path="/"
          element={
            <Protected>
              <Dashboard />
            </Protected>
          }
        />
        <Route
          path="/transactions"
          element={
            <Protected>
              <Transactions />
            </Protected>
          }
        />
        <Route
          path="/monthly"
          element={
            <Protected>
              <Monthly />
            </Protected>
          }
        />
        <Route
          path="/income"
          element={
            <Protected>
              <Income />
            </Protected>
          }
        />
        <Route
          path="/expenses"
          element={
            <Protected>
              <Expenses />
            </Protected>
          }
        />
        <Route
          path="/lending"
          element={
            <Protected>
              <Lending />
            </Protected>
          }
        />
        <Route
          path="/borrowing"
          element={
            <Protected>
              <Borrowing />
            </Protected>
          }
        />
        <Route
          path="/accounts"
          element={
            <Protected>
              <Accounts />
            </Protected>
          }
        />
        <Route
          path="/analytics"
          element={
            <Protected>
              <Analytics />
            </Protected>
          }
        />
        <Route
          path="/reports"
          element={
            <Protected>
              <Reports />
            </Protected>
          }
        />
        <Route
          path="/categories"
          element={
            <Protected>
              <Categories />
            </Protected>
          }
        />
        <Route
          path="/settings"
          element={
            <Protected>
              <Settings />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
