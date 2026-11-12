#!/usr/bin/env bash
# Оновлення до нової версії з GitHub: sudo bash /opt/vudo/deploy/update.sh
set -euo pipefail
cd /opt/vudo
echo "==> Резервна копія перед оновленням"
sudo -u vudo bash deploy/backup.sh
echo "==> Новий код"
sudo -u vudo git pull --ff-only
echo "==> Збірка"
sudo -u vudo bash -c "npm ci && npm run build"
echo "==> Перезапуск (міграції застосуються при старті)"
systemctl restart vudo
sleep 3
systemctl is-active --quiet vudo && curl -fsS http://127.0.0.1:3000/api/health && echo " — працює"
