-- Документи → «Первинні документи»: реєстр рахунків, накладних, актів та інших документів по ТОВ і ФОП (лише власник).
-- Юрособи, для яких ведеться реєстр первинних документів (фізособа — ні).
ALTER TABLE legal_entities ADD COLUMN primary_docs boolean NOT NULL DEFAULT true;
UPDATE legal_entities SET primary_docs = false WHERE name ILIKE 'фізична особа%';

CREATE TABLE primary_docs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id     bigint        NOT NULL REFERENCES legal_entities(id),
  kind          text          NOT NULL DEFAULT 'Рахунок' CHECK (kind IN ('Рахунок', 'Видаткова накладна', 'Акт виконаних робіт', 'Податкова накладна', 'Інший документ')),
  -- Вхідний — отримали від постачальника; вихідний — виписали клієнту
  direction     text          NOT NULL DEFAULT 'Вхідний' CHECK (direction IN ('Вхідний', 'Вихідний')),
  num           text          NOT NULL DEFAULT '',
  doc_date      date,
  counterparty  text          COLLATE ukr NOT NULL CHECK (length(btrim(counterparty)) > 0),
  subject       text          NOT NULL DEFAULT '',
  amount        numeric(14,2) CHECK (amount >= 0),
  pay_status    text          NOT NULL DEFAULT '' CHECK (pay_status IN ('', 'Оплачено', 'Частково', 'Не оплачено')),
  storage       text          NOT NULL DEFAULT '' CHECK (storage IN ('', 'Фізично', 'Електронно', 'Фізично і електронно')),
  location      text          NOT NULL DEFAULT '',
  note          text          NOT NULL DEFAULT '',
  archived      boolean       NOT NULL DEFAULT false,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  created_by    bigint        REFERENCES users(id)
);
CREATE INDEX primary_docs_entity_idx ON primary_docs (entity_id, doc_date DESC) WHERE NOT archived;
CREATE TABLE primary_doc_files (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doc_id       bigint      NOT NULL REFERENCES primary_docs(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  size         bigint      NOT NULL,
  mime         text,
  storage_key  text        NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   bigint      REFERENCES users(id)
);
CREATE INDEX primary_doc_files_idx ON primary_doc_files (doc_id);
