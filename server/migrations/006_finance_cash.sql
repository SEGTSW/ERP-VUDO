-- Етап 4 «Фінанси», частина 1: статейник і облік руху коштів (ТЗ 10.1, 10.8).

-- Статейник: стаття → підстаття → об'єкт (порожньо = уся підстаття), рядок P&L, прив'язка до замовлення.
CREATE TABLE articles (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type        text        NOT NULL CHECK (type IN ('Дохід','Витрата','Інвестиції+','Інвестиції-','Позика+','Позика-','Позика','Дивіденди')),
  cat         text        COLLATE ukr NOT NULL DEFAULT '',
  obj         text        COLLATE ukr NOT NULL DEFAULT '',
  default_cp  text        NOT NULL DEFAULT '',
  line        text        NOT NULL CHECK (line IN ('income','orderCost','admin','payroll','other','marketing','tax','logistics','collab',
                                                   'credit','working','invPlus','invMinus','dividends','loan','none')),
  to_order    boolean     NOT NULL DEFAULT false,
  hidden      boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX articles_uniq ON articles (type, cat, obj) WHERE NOT hidden;

-- Операції обліку. Сума зі знаком (витрати — мінус). Оплати клієнтів і виплати дизайнерам
-- сюди не пишуться — вони показуються в обліку автоматично з власних таблиць.
CREATE TABLE cash_ops (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date          date          NOT NULL,
  type          text          NOT NULL CHECK (type IN ('Дохід','Витрата','Інвестиції+','Інвестиції-','Позика+','Позика-','Позика','Дивіденди')),
  cat           text          COLLATE ukr NOT NULL DEFAULT '',
  obj           text          NOT NULL DEFAULT '',
  order_id      bigint        REFERENCES orders(id),
  counterparty  text          NOT NULL DEFAULT '',
  note          text          NOT NULL DEFAULT '',
  account       text          NOT NULL CHECK (account IN ('Карта', 'Готівка')),
  sum           numeric(14,2) NOT NULL CHECK (sum <> 0),
  fixed_id      bigint,
  source        text          NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  created_by    bigint        REFERENCES users(id),
  updated_at    timestamptz,
  updated_by    bigint        REFERENCES users(id)
);
CREATE INDEX cash_ops_date_idx ON cash_ops (date);
CREATE INDEX cash_ops_order_idx ON cash_ops (order_id) WHERE order_id IS NOT NULL;

-- Стартовий статейник (з листа замовника «Статті список»; точні назви замовник уточнить).
INSERT INTO articles (type, cat, obj, line, to_order, default_cp) VALUES
  ('Дохід', 'Замовлення', '', 'income', true, 'Замовник'),
  ('Дохід', 'Інші', 'Обмін коштів', 'none', false, ''),
  ('Дохід', 'Інші', 'Банк', 'none', false, ''),
  ('Дохід', 'Кредити', 'Надходження', 'credit', false, ''),
  ('Дохід', 'Зведення обліку', '', 'none', false, ''),
  ('Дохід', 'Поповнення', 'Банк', 'none', false, ''),
  ('Витрата', 'Замовлення', '', 'orderCost', true, ''),
  ('Витрата', 'Логістика', '', 'logistics', true, ''),
  ('Витрата', 'Співпраці', 'Виплата', 'collab', true, ''),
  ('Витрата', 'Адміністративні', 'Зв’язок', 'admin', false, ''),
  ('Витрата', 'Адміністративні', 'Робочий одяг', 'admin', false, 'Ліндстрем'),
  ('Витрата', 'Адміністративні', 'Цех', 'admin', false, 'Оренда'),
  ('Витрата', 'Адміністративні', 'СРМ', 'admin', false, ''),
  ('Витрата', 'Адміністративні', 'ТОВ', 'admin', false, ''),
  ('Витрата', 'Адміністративні', 'Телефонія', 'admin', false, ''),
  ('Витрата', 'Маркетинг', 'Фейсбук', 'marketing', false, ''),
  ('Витрата', 'Маркетинг', 'Брендовка', 'marketing', false, ''),
  ('Витрата', 'Податки та збори', 'ФОП', 'tax', false, ''),
  ('Витрата', 'Фонд оплати праці', 'Заробітня плата', 'payroll', false, ''),
  ('Витрата', 'Інші', 'Цех', 'other', false, ''),
  ('Витрата', 'Інші', 'Переробка', 'other', false, ''),
  ('Витрата', 'Інші', 'IT', 'other', false, ''),
  ('Витрата', 'Інші', 'Гугл', 'other', false, ''),
  ('Витрата', 'Інші', 'Поїздки', 'other', false, ''),
  ('Витрата', 'Інші', 'ШІ', 'other', false, ''),
  ('Витрата', 'Інші', 'Інструмент', 'other', false, ''),
  ('Витрата', 'Інші', 'Офіс', 'other', false, ''),
  ('Витрата', 'Інші', 'Інші', 'other', false, ''),
  ('Витрата', 'Інші', 'Обмін коштів', 'none', false, ''),
  ('Витрата', 'Інші', 'Банк', 'none', false, ''),
  ('Витрата', 'Кредити', 'Виплата', 'credit', false, ''),
  ('Інвестиції+', '', '', 'invPlus', false, 'Єфімов Олег'),
  ('Інвестиції-', '', '', 'invMinus', false, 'Єфімов Олег'),
  ('Позика+', '', '', 'loan', false, 'Єфімов Дем’ян'),
  ('Позика-', '', '', 'loan', false, 'Єфімов Дем’ян'),
  ('Позика', '', '', 'loan', false, ''),
  ('Дивіденди', '', '', 'dividends', false, 'Єфімов Дем’ян');
