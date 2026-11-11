-- Сортування за українським алфавітом (А, Б, … Є, … І, Ї, … Я) для імен і назв.
-- Без цього «Ігор» стояв би перед «Андрієм» (порівняння за кодами символів).
CREATE COLLATION IF NOT EXISTS ukr (provider = icu, locale = 'uk-UA');

ALTER TABLE users   ALTER COLUMN name TYPE text COLLATE ukr;
ALTER TABLE clients ALTER COLUMN name TYPE text COLLATE ukr;
ALTER TABLE clients ALTER COLUMN company TYPE text COLLATE ukr;
ALTER TABLE items   ALTER COLUMN name TYPE text COLLATE ukr;
