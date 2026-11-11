-- Етап 3 «Виробництво»: брак і нестачі, склад залишків.

-- 8А.2 Не вистачає / брак деталі
CREATE TABLE issues (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id       bigint      NOT NULL REFERENCES orders(id),
  item_id        bigint      REFERENCES items(id) ON DELETE SET NULL,
  type           text        NOT NULL CHECK (type IN ('Не вистачає', 'Брак деталі')),
  text           text        NOT NULL CHECK (length(btrim(text)) > 0),
  qty            text,
  urgent         boolean     NOT NULL DEFAULT false,
  photo_file_id  bigint      REFERENCES order_files(id),
  status         text        NOT NULL DEFAULT 'нове' CHECK (status IN ('нове', 'замовлено', 'вирішено')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     bigint      REFERENCES users(id),
  status_at      timestamptz,
  status_by      bigint      REFERENCES users(id)
);
CREATE INDEX issues_order_idx ON issues (order_id) WHERE status <> 'вирішено';

-- 8А.4 Склад залишків: обрізки й матеріали після замовлень. Цін і сум немає.
CREATE TABLE stock_items (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind           text          NOT NULL CHECK (kind IN ('Плита', 'Стільниця', 'Фурнітура', 'Профіль', 'Інше')),
  material       text          COLLATE ukr NOT NULL CHECK (length(btrim(material)) > 0),
  thick          integer       CHECK (thick > 0),
  -- плита: ширина × висота; стільниця: довжина × глибина (мм)
  w              integer       CHECK (w > 0),
  h              integer       CHECK (h > 0),
  qty            numeric(12,3) NOT NULL CHECK (qty >= 0),
  unit           text          NOT NULL DEFAULT 'шт' CHECK (unit IN ('шт', 'м', 'пар', 'уп', 'м²', 'кг')),
  place          text,
  from_order_id  bigint        REFERENCES orders(id),
  note           text,
  status         text          NOT NULL DEFAULT 'вільний' CHECK (status IN ('вільний', 'резерв', 'використано')),
  res_order_id   bigint        REFERENCES orders(id),
  created_at     timestamptz   NOT NULL DEFAULT now(),
  created_by     bigint        REFERENCES users(id),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  updated_by     bigint        REFERENCES users(id),
  -- розміри обов'язкові для плити й стільниці
  CHECK (kind NOT IN ('Плита', 'Стільниця') OR (w IS NOT NULL AND h IS NOT NULL)),
  CHECK (status <> 'резерв' OR res_order_id IS NOT NULL)
);
CREATE INDEX stock_items_status_idx ON stock_items (status);
CREATE INDEX stock_items_res_idx ON stock_items (res_order_id) WHERE res_order_id IS NOT NULL;
