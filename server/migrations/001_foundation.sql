-- Етап 1 «Основа»: користувачі, сесії, налаштування, журнал дій, прочитаність повідомлень.

CREATE TABLE users (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name           text        NOT NULL CHECK (length(btrim(name)) > 0),
  login          text        NOT NULL UNIQUE CHECK (login ~ '^[a-z0-9._-]{3,}$'),
  password_hash  text        NOT NULL,
  roles          text[]      NOT NULL CHECK (
                   cardinality(roles) > 0
                   AND roles <@ ARRAY['Адмін','Менеджер','Замірник','Конструктор','Технолог','Цех','Монтажник']::text[]
                 ),
  phone          text,
  disabled       boolean     NOT NULL DEFAULT false,
  -- налаштування профілю
  theme          text        CHECK (theme IN ('light', 'dark')),
  start_section  text,
  orders_rows    integer     CHECK (orders_rows IN (25, 50, 100)),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     bigint      REFERENCES users(id)
);

-- Сесії: у БД лише SHA-256 від токена, сам токен — тільки в httpOnly-cookie.
CREATE TABLE sessions (
  token_hash    bytea       PRIMARY KEY,
  user_id       bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ip            text,
  user_agent    text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE settings (
  key         text        PRIMARY KEY,
  value       jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  bigint      REFERENCES users(id)
);

-- Журнал: кожна зміна з автором, часом і текстом «поле: було → стало».
-- Папку і рівень фінансового доступу ставить сервер у місці створення запису.
CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    bigint      REFERENCES users(id),
  order_id   bigint,
  text       text        NOT NULL,
  folder     text        NOT NULL CHECK (folder IN ('fin','issue','stock','zamir','order','plan','mont','client','files','other')),
  fin_scope  text        CHECK (fin_scope IN ('pay', 'report')),
  CHECK ((folder = 'fin') = (fin_scope IS NOT NULL))
);
CREATE INDEX audit_log_order_idx ON audit_log (order_id, id DESC) WHERE order_id IS NOT NULL;
CREATE INDEX audit_log_folder_idx ON audit_log (folder, id DESC);

-- Прочитаність: по користувачу і папці — id останнього прочитаного запису.
CREATE TABLE log_reads (
  user_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder   text   NOT NULL,
  last_id  bigint NOT NULL,
  PRIMARY KEY (user_id, folder)
);
