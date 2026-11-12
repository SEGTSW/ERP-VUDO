# Розгортання VUDO ERP на Hetzner

## 1. Сервер
1. **Hetzner Cloud → Add Server**:
   - образ **Ubuntu 24.04**;
   - тип **CX22** (2 vCPU, 4 ГБ) — з запасом для команди до ~30 людей;
   - локація найближча: Helsinki або Falkenstein / Nuremberg.
2. **SSH key**: додайте свій публічний ключ (вхід за паролем не потрібен).
3. Увімкніть **Backups** у налаштуваннях сервера (щоденні знімки всього диска, 7 днів) — додатковий захист до наших копій.

## 2. Домен
У DNS вашого домену створіть запис **A**: `erp.ваш-домен.ua → IP сервера`. Дочекайтесь, поки запис почне працювати (`ping erp.ваш-домен.ua`).

## 3. Встановлення (один раз)
```bash
ssh root@IP_СЕРВЕРА
curl -fsSL https://raw.githubusercontent.com/SEGTSW/ERP-VUDO/main/deploy/setup-server.sh -o setup.sh
DOMAIN=erp.ваш-домен.ua EMAIL=ваш@email.com bash setup.sh
```
> Якщо репозиторій приватний — спершу додайте на сервері deploy key (GitHub → Settings → Deploy keys) і запускайте з `REPO=git@github.com:SEGTSW/ERP-VUDO.git`.

Скрипт сам встановить Node.js 24, PostgreSQL, nginx, фаєрвол, HTTPS-сертифікат, створить базу з випадковим паролем (у `/opt/vudo/.env`), збере застосунок і запустить його та щоденну резервну копію.

Перший власник (пароль запитається в терміналі):
```bash
cd /opt/vudo && sudo -u vudo npm run create-admin -- --login owner --name "Ім'я Прізвище"
```
Відкрийте `https://erp.ваш-домен.ua`.

## 4. Оновлення до нової версії
```bash
sudo bash /opt/vudo/deploy/update.sh
```
Робить резервну копію → забирає код з GitHub → збирає → перезапускає (міграції бази — автоматично).

## 5. Резервні копії (ТЗ: щодня, 30 днів)
- Щодня о 03:30: база (`pg_dump`) + файли замовлень → `/var/backups/vudo`, старші за 30 днів видаляються.
- **Рекомендовано зберігати копії поза сервером** — Hetzner **Storage Box** (BX11, ~4 €/міс):
  1. Створіть Storage Box, увімкніть SSH, додайте публічний ключ користувача `vudo`
     (`sudo -u vudo ssh-keygen -t ed25519`, вміст `/home/vudo/.ssh/id_ed25519.pub`).
  2. Додайте в `/opt/vudo/.env`: `BACKUP_REMOTE=u123456@u123456.your-storagebox.de:vudo`
- Перевірити вручну: `sudo systemctl start vudo-backup && ls -lh /var/backups/vudo`
- Відновити: `sudo bash /opt/vudo/deploy/restore.sh 2026-11-12_0330`

## 6. Корисне
| Що | Команда |
|---|---|
| Стан застосунку | `systemctl status vudo` |
| Журнал сервера | `journalctl -u vudo -f` |
| Перезапуск | `sudo systemctl restart vudo` |
| Коли наступна копія | `systemctl list-timers vudo-backup.timer` |
| Сертифікат (оновлюється сам) | `certbot renew --dry-run` |
