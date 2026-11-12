-- 12В Табель: години 0–24 (до 2 знаків) або позначки В / Л / ВП / П. У журнал не пишеться.
CREATE TABLE timesheet (
  user_id     bigint      NOT NULL REFERENCES users(id),
  date        date        NOT NULL,
  value       text        NOT NULL CHECK (value IN ('В', 'Л', 'ВП', 'П') OR (value ~ '^\d{1,2}(\.\d{1,2})?$' AND value::numeric <= 24)),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  bigint      REFERENCES users(id),
  PRIMARY KEY (user_id, date)
);
