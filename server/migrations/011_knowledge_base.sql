-- 12Б База знань: матеріали, файли-оригінали, ознайомлення.
CREATE TABLE kb_articles (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title       text        COLLATE ukr NOT NULL CHECK (length(btrim(title)) > 0),
  cat         text        NOT NULL CHECK (cat IN ('Компанія', 'Клієнт', 'Регламенти', 'Шаблони і документи', 'Навчання')),
  body        text        NOT NULL DEFAULT '',
  vis         text        NOT NULL DEFAULT 'all' CHECK (vis IN ('all', 'office')),
  pinned      boolean     NOT NULL DEFAULT false,
  draft       boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  bigint      REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  bigint      REFERENCES users(id)
);

CREATE TABLE kb_files (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  article_id   bigint      NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  size         bigint      NOT NULL,
  mime         text,
  storage_key  text        NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   bigint      REFERENCES users(id)
);

CREATE TABLE kb_reads (
  article_id  bigint      NOT NULL REFERENCES kb_articles(id) ON DELETE CASCADE,
  user_id     bigint      NOT NULL REFERENCES users(id),
  read_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, user_id)
);

-- Стартові чернетки (ТЗ 12Б): тексти заповнює замовник зі своїх файлів.
INSERT INTO kb_articles (title, cat, pinned, draft, body) VALUES
  ('Місія', 'Компанія', true, true, '# Місія VUDO

_Текст місії — замовник заповнює зі своїх матеріалів._'),
  ('Візія', 'Компанія', true, true, '# Візія

_Куди ми рухаємось — замовник заповнює._'),
  ('Цінності', 'Компанія', false, true, '# Цінності

- Цінність 1
- Цінність 2
- Цінність 3'),
  ('Дорожня карта клієнта', 'Клієнт', true, true, '# Дорожня карта клієнта

1. Звернення
2. Прорахунок
3. Замір
4. Очікування рішення клієнта
5. Проєктування і погодження
6. Договір і аванс
7. Виробництво
8. Доставка і монтаж
9. Закриття замовлення'),
  ('Регламент заміру', 'Регламенти', false, true, '# Регламент заміру

## Перед виїздом
- 

## На об''єкті
- '),
  ('Регламент монтажу', 'Регламенти', false, true, '# Регламент монтажу

## Перед виїздом
- 

## На об''єкті
- ');
