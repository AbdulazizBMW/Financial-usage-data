/**
 * Complete relational schema for the personal finance manager.
 * Every statement is idempotent so the app can migrate on every boot.
 * Money is always stored as NUMERIC(20,2) and rates as NUMERIC(20,8):
 * no floating point value ever touches a financial amount.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  base_currency text NOT NULL DEFAULT 'UZS',
  theme text NOT NULL DEFAULT 'light',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id);

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_unique_idx ON categories (user_id, kind, lower(name));

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('cash','card','bank','other')),
  currency text NOT NULL DEFAULT 'UZS',
  opening_balance numeric(20,2) NOT NULL DEFAULT 0,
  opening_date date NOT NULL DEFAULT CURRENT_DATE,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounts_user_idx ON accounts (user_id);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('income','expense','transfer')),
  txn_date date NOT NULL,
  amount numeric(20,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  fx_rate numeric(20,8) NOT NULL DEFAULT 1,
  account_id uuid NOT NULL REFERENCES accounts(id),
  account_amount numeric(20,2) NOT NULL,
  base_amount numeric(20,2) NOT NULL,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  counter_account_id uuid REFERENCES accounts(id),
  counter_amount numeric(20,2),
  counter_base_amount numeric(20,2),
  description text NOT NULL DEFAULT '',
  payment_method text NOT NULL DEFAULT 'cash',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_user_date_idx ON transactions (user_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS transactions_user_kind_idx ON transactions (user_id, kind);
CREATE INDEX IF NOT EXISTS transactions_user_category_idx ON transactions (user_id, category_id);
CREATE INDEX IF NOT EXISTS transactions_user_account_idx ON transactions (user_id, account_id);

CREATE TABLE IF NOT EXISTS loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('lend','borrow')),
  counterparty text NOT NULL,
  amount numeric(20,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  fx_rate numeric(20,8) NOT NULL,
  account_amount numeric(20,2) NOT NULL,
  base_amount numeric(20,2) NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  loan_date date NOT NULL,
  due_date date,
  description text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loans_user_idx ON loans (user_id, direction, loan_date DESC);

CREATE TABLE IF NOT EXISTS loan_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  loan_id uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  pay_date date NOT NULL,
  amount numeric(20,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  fx_rate numeric(20,8) NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  account_amount numeric(20,2) NOT NULL,
  base_amount numeric(20,2) NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loan_payments_user_idx ON loan_payments (user_id, pay_date DESC);
CREATE INDEX IF NOT EXISTS loan_payments_loan_idx ON loan_payments (loan_id);

CREATE TABLE IF NOT EXISTS fx_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency text NOT NULL,
  rate numeric(20,8) NOT NULL CHECK (rate > 0),
  as_of date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fx_rates_unique_idx ON fx_rates (user_id, currency, as_of);

CREATE TABLE IF NOT EXISTS backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('auto','manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  size_bytes integer NOT NULL DEFAULT 0,
  record_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS backups_user_idx ON backups (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity text NOT NULL,
  entity_id text,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log (user_id, created_at DESC);

CREATE OR REPLACE VIEW v_cash_movements AS
  SELECT t.user_id, t.account_id, t.txn_date AS d,
         CASE t.kind WHEN 'income' THEN t.account_amount
                     WHEN 'expense' THEN -t.account_amount
                     ELSE -t.account_amount END AS account_delta,
         CASE t.kind WHEN 'income' THEN t.base_amount
                     WHEN 'expense' THEN -t.base_amount
                     ELSE -t.base_amount END AS base_delta
    FROM transactions t
  UNION ALL
  SELECT t.user_id, t.counter_account_id, t.txn_date,
         t.counter_amount, t.counter_base_amount
    FROM transactions t
   WHERE t.kind = 'transfer' AND t.counter_account_id IS NOT NULL
  UNION ALL
  SELECT l.user_id, l.account_id, l.loan_date,
         CASE l.direction WHEN 'lend' THEN -l.account_amount ELSE l.account_amount END,
         CASE l.direction WHEN 'lend' THEN -l.base_amount ELSE l.base_amount END
    FROM loans l
  UNION ALL
  SELECT p.user_id, p.account_id, p.pay_date,
         CASE l.direction WHEN 'lend' THEN p.account_amount ELSE -p.account_amount END,
         CASE l.direction WHEN 'lend' THEN p.base_amount ELSE -p.base_amount END
    FROM loan_payments p
    JOIN loans l ON l.id = p.loan_id;
`;
