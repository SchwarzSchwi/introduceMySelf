CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_display_name_ci
  ON accounts (lower(display_name));

CREATE TABLE IF NOT EXISTS passkey_credentials (
  credential_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  credential_name text NOT NULL,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS passkey_credentials_account_id
  ON passkey_credentials (account_id);

CREATE TABLE IF NOT EXISTS auth_challenges (
  challenge text PRIMARY KEY,
  flow text NOT NULL CHECK (flow IN ('register-new', 'register-add', 'login')),
  account_id text,
  account_name text,
  credential_name text,
  session_hash text,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS private_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS private_items_account_id
  ON private_items (account_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_sessions_expires_at
  ON auth_sessions (expires_at);
