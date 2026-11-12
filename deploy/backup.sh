#!/usr/bin/env bash
# Щоденна резервна копія бази і файлів (ТЗ: щодня, зберігання 30 днів).
# Локально: /var/backups/vudo. Якщо задано BACKUP_REMOTE (наприклад, Hetzner Storage Box
# u123456@u123456.your-storagebox.de:vudo) — копії ще й синхронізуються туди по SSH (порт 23).
set -euo pipefail
cd /opt/vudo
set -a; source .env; set +a

DIR=/var/backups/vudo
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
TS="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DIR"

pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$DIR/db_$TS.dump"
tar -C "$(dirname "$UPLOAD_DIR")" -czf "$DIR/files_$TS.tar.gz" "$(basename "$UPLOAD_DIR")"

# Перевірка, що дамп читається
pg_restore --list "$DIR/db_$TS.dump" >/dev/null

find "$DIR" -maxdepth 1 -type f \( -name 'db_*.dump' -o -name 'files_*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete

if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  rsync -a --delete -e "ssh -p 23 -o BatchMode=yes" "$DIR/" "$BACKUP_REMOTE/"
fi
echo "Резервну копію створено: $TS"
