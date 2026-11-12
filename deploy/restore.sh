#!/usr/bin/env bash
# Відновлення з резервної копії. УВАГА: замінює поточну базу і файли.
#   sudo bash /opt/vudo/deploy/restore.sh 2026-11-12_0330
set -euo pipefail
TS="${1:?Вкажіть мітку копії, напр. 2026-11-12_0330 (дивіться ls /var/backups/vudo)}"
DIR=/var/backups/vudo
cd /opt/vudo
set -a; source .env; set +a
[[ -f "$DIR/db_$TS.dump" && -f "$DIR/files_$TS.tar.gz" ]] || { echo "Копію $TS не знайдено в $DIR"; exit 1; }

read -r -p "Замінити поточну базу і файли копією $TS? Введіть ТАК: " ok
[[ "$ok" == "ТАК" ]] || { echo "Скасовано."; exit 1; }

systemctl stop vudo
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$DIR/db_$TS.dump"
rm -rf "${UPLOAD_DIR}.before-restore" && mv "$UPLOAD_DIR" "${UPLOAD_DIR}.before-restore"
tar -C "$(dirname "$UPLOAD_DIR")" -xzf "$DIR/files_$TS.tar.gz"
chown -R vudo:vudo "$UPLOAD_DIR"
systemctl start vudo
echo "Відновлено з $TS. Попередні файли збережено в ${UPLOAD_DIR}.before-restore"
