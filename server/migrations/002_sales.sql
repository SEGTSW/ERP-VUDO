-- Етап 2 «Продажі»: клієнти й дизайнери-партнери, замовлення, вироби, оплати, файли, коментарі, етапи плану.

-- Ключ унікальності телефону — останні 10 цифр.
CREATE FUNCTION phone_key(p text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10);

CREATE TABLE clients (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text        NOT NULL CHECK (length(btrim(name)) > 0),
  phone       text,
  type        text        NOT NULL DEFAULT 'фізособа' CHECK (type IN ('фізособа', 'юрособа', 'дизайнер-партнер')),
  source      text        CHECK (source IN ('сайт', 'Instagram', 'рекомендація', 'повторний клієнт', 'дизайнер', 'інше')),
  email       text,
  messenger   text,
  -- лише для дизайнера-партнера
  company     text,
  bonus_pct   numeric(5,2) CHECK (bonus_pct BETWEEN 0 AND 100),
  addresses   text[]      NOT NULL DEFAULT '{}',
  comment     text,
  archived    boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  bigint      REFERENCES users(id),
  -- телефон обов'язковий (≥ 9 цифр), крім дизайнера-партнера
  CHECK (type = 'дизайнер-партнер' OR length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 9)
);
-- Один телефон — один контакт (клієнти й дизайнери разом).
CREATE UNIQUE INDEX clients_phone_uniq ON clients (phone_key(phone)) WHERE phone_key(phone) <> '';
CREATE INDEX clients_type_idx ON clients (type) WHERE NOT archived;

-- Наскрізна нумерація замовлень: РРРР-NNNN, NNNN не скидається з новим роком.
CREATE SEQUENCE order_num_seq;

CREATE TABLE orders (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  num             text        NOT NULL UNIQUE,
  client_id       bigint      NOT NULL REFERENCES clients(id),
  address         text,
  manager_id      bigint      NOT NULL REFERENCES users(id),
  source          text        CHECK (source IN ('сайт', 'Instagram', 'рекомендація', 'повторний клієнт', 'дизайнер', 'інше')),
  designer_id     bigint      REFERENCES clients(id),
  status          text        NOT NULL DEFAULT 'Звернення',
  status_since    date        NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Kyiv')::date,
  measure_date    date,
  measurer_id     bigint      REFERENCES users(id),
  constructor_id  bigint      REFERENCES users(id),
  -- монтажники: перший — відповідальний за етап «Монтаж»
  installer_ids   bigint[]    NOT NULL DEFAULT '{}',
  ready_date      date,
  install_date    date,
  delivery        numeric(12,2) NOT NULL DEFAULT 0 CHECK (delivery >= 0),
  discount        numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  discount_type   text        NOT NULL DEFAULT 'грн' CHECK (discount_type IN ('грн', '%')),
  contract_date   date,
  contract_price  numeric(12,2),
  closed_date     date,
  closed_cost     numeric(12,2),
  -- постійні (операційні) витрати замовлення; NULL = авто
  opex            numeric(12,2) CHECK (opex >= 0),
  refuse_reason   text,
  claim_text      text,
  comment         text,
  archived        boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      bigint      REFERENCES users(id),
  CHECK (status IN ('Звернення','Замір призначено','Замір виконано','Прорахунок','Очікує рішення клієнта',
    'Договір / аванс отримано','Проєктування','Проєкт погоджено','Закупівля матеріалів','У виробництві',
    'Готово до відвантаження','Доставка / монтаж призначено','Змонтовано','Закрито','Відмова','Рекламація')),
  CHECK (discount_type <> '%' OR discount <= 100)
);
CREATE INDEX orders_client_idx ON orders (client_id);
CREATE INDEX orders_designer_idx ON orders (designer_id) WHERE designer_id IS NOT NULL;
CREATE INDEX orders_status_idx ON orders (status) WHERE NOT archived;

ALTER TABLE audit_log ADD CONSTRAINT audit_log_order_fk FOREIGN KEY (order_id) REFERENCES orders(id);

-- Виріб: ціна не вводиться — рахується з прорахунку (6 сум) за формулами розділу 14.
CREATE TABLE items (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id      bigint      NOT NULL REFERENCES orders(id),
  name          text        NOT NULL CHECK (length(btrim(name)) > 0),
  type          text        NOT NULL DEFAULT 'інше' CHECK (type IN ('шафа-купе','розпашна шафа','кухня','гардеробна','передпокій','інше')),
  description   text,
  pre           jsonb       NOT NULL DEFAULT '{}',
  exact         jsonb,
  designer_pct  numeric(5,2) CHECK (designer_pct BETWEEN 0 AND 100),
  -- націнка на момент збереження прорахунку: зміна налаштувань не змінює вже пораховані ціни
  markup_pct    numeric(6,2) NOT NULL CHECK (markup_pct >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    bigint      REFERENCES users(id)
);
CREATE INDEX items_order_idx ON items (order_id);

CREATE TABLE payments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint        NOT NULL REFERENCES orders(id),
  sum         numeric(12,2) NOT NULL CHECK (sum > 0),
  type        text          NOT NULL CHECK (type IN ('аванс', 'доплата', 'інше', 'повернення')),
  method      text          NOT NULL CHECK (method IN ('готівка', 'картка', 'рахунок')),
  date        date          NOT NULL,
  comment     text,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  created_by  bigint        REFERENCES users(id)
);
CREATE INDEX payments_order_idx ON payments (order_id);
CREATE INDEX payments_date_idx ON payments (date);

CREATE TABLE order_files (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     bigint      NOT NULL REFERENCES orders(id),
  category     text        NOT NULL CHECK (category IN ('design', 'spec', 'constr', 'other')),
  name         text        NOT NULL,
  size         bigint      NOT NULL CHECK (size >= 0),
  mime         text,
  storage_key  text        NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   bigint      REFERENCES users(id)
);
CREATE INDEX order_files_order_idx ON order_files (order_id);

CREATE TABLE order_comments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint      NOT NULL REFERENCES orders(id),
  text        text        NOT NULL CHECK (length(btrim(text)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  bigint      REFERENCES users(id)
);
CREATE INDEX order_comments_order_idx ON order_comments (order_id);

-- Етапи плану: по 5 на кожен виріб (Прорахунок → Замір → Конструктив → Збірка → Монтаж).
CREATE TABLE plan_tasks (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     bigint      NOT NULL REFERENCES orders(id),
  item_id      bigint      NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  stage        text        NOT NULL CHECK (stage IN ('Прорахунок', 'Замір', 'Конструктив', 'Збірка', 'Монтаж')),
  idx          smallint    NOT NULL CHECK (idx BETWEEN 1 AND 5),
  assignee_id  bigint      REFERENCES users(id),
  start_date   date,
  days         smallint    CHECK (days BETWEEN 1 AND 120),
  progress     smallint    NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  comment      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, stage)
);
CREATE INDEX plan_tasks_order_idx ON plan_tasks (order_id);
CREATE INDEX plan_tasks_assignee_idx ON plan_tasks (assignee_id) WHERE progress < 100;
