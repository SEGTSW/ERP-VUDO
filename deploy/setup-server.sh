#!/usr/bin/env bash
# Перше налаштування сервера Hetzner (Ubuntu 24.04) для VUDO ERP. Запускати від root один раз:
#   DOMAIN=erp.example.com EMAIL=you@example.com bash setup-server.sh
set -euo pipefail

: "${DOMAIN:?Вкажіть DOMAIN=erp.ваш-домен.ua}"
: "${EMAIL:?Вкажіть EMAIL для сертифіката Let’s Encrypt}"
REPO="${REPO:-https://github.com/SEGTSW/ERP-VUDO.git}"
APP_DIR=/opt/vudo
DATA_DIR=/var/lib/vudo
BACKUP_DIR=/var/backups/vudo

echo "==> Оновлення системи і базові пакети"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git ufw nginx certbot python3-certbot-nginx postgresql postgresql-contrib unattended-upgrades rsync

echo "==> Node.js 24 LTS"
if ! command -v node >/dev/null || [[ "$(node -v)" != v24* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

echo "==> Автоматичні оновлення безпеки"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Фаєрвол: лише SSH, HTTP, HTTPS"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> Системний користувач vudo"
id vudo >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/vudo --shell /usr/sbin/nologin vudo
mkdir -p "$DATA_DIR/uploads" "$BACKUP_DIR"
chown -R vudo:vudo "$DATA_DIR" "$BACKUP_DIR"
chmod 750 "$DATA_DIR" "$BACKUP_DIR"

echo "==> База даних PostgreSQL"
DB_PASS="$(openssl rand -hex 24)"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='vudo'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE vudo LOGIN PASSWORD '$DB_PASS'"
  sudo -u postgres psql -c "CREATE DATABASE vudo_erp OWNER vudo ENCODING 'UTF8' TEMPLATE template0"
  NEW_DB=1
else
  echo "   Роль vudo вже існує — пароль не змінюю."
  NEW_DB=0
fi

echo "==> Код застосунку"
if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone "$REPO" "$APP_DIR"
fi
chown -R vudo:vudo "$APP_DIR"

if [[ ! -f "$APP_DIR/.env" ]]; then
  if [[ "$NEW_DB" != 1 ]]; then echo "!! .env відсутній, а роль БД уже є — створіть .env вручну."; exit 1; fi
  cat > "$APP_DIR/.env" <<ENV
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://vudo:${DB_PASS}@127.0.0.1:5432/vudo_erp
COOKIE_SECURE=true
TRUST_PROXY=1
SESSION_DAYS=30
UPLOAD_DIR=${DATA_DIR}/uploads
ENV
  chown vudo:vudo "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
fi

echo "==> Збірка"
sudo -u vudo bash -c "cd $APP_DIR && npm ci && npm run build"

echo "==> Сервіси systemd (застосунок і щоденна резервна копія)"
install -m 644 "$APP_DIR/deploy/vudo.service" /etc/systemd/system/vudo.service
install -m 644 "$APP_DIR/deploy/vudo-backup.service" /etc/systemd/system/vudo-backup.service
install -m 644 "$APP_DIR/deploy/vudo-backup.timer" /etc/systemd/system/vudo-backup.timer
systemctl daemon-reload
systemctl enable --now vudo.service
systemctl enable --now vudo-backup.timer

echo "==> nginx + HTTPS"
sed "s/__DOMAIN__/${DOMAIN}/g" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/vudo
ln -sf /etc/nginx/sites-available/vudo /etc/nginx/sites-enabled/vudo
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx --non-interactive --agree-tos -m "$EMAIL" -d "$DOMAIN" --redirect

echo
echo "Готово. Далі створіть першого власника:"
echo "  cd $APP_DIR && sudo -u vudo npm run create-admin -- --login owner --name \"Ім'я Прізвище\""
echo "Відкрийте https://${DOMAIN}"
