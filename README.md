# Toptry (виртуальная примерочная) — dev kit

Этот репозиторий содержит прототип web-приложения Toptry:
- Frontend: Vite + React
- Backend: Express (AI + media proxy)
- AI: Gemini (image model)

## 1) Быстрый старт (без БД)

1. Скопируйте `.env.example` → `.env.local` и укажите `GEMINI_API_KEY`.
2. Установка:
   ```bash
   npm install
   ```
3. Запуск:
   ```bash
   npm run dev
   ```

Frontend: http://localhost:3000
Backend: http://localhost:5174

## 2) "Нормальная" инфраструктура (Postgres + MinIO)

1. Поднимите сервисы:
   ```bash
   npm run db:up
   ```
2. Примените миграции Prisma:
   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```
3. В `.env.local` проверьте `DATABASE_URL` и `MINIO_*`.
   Также задайте `JWT_SECRET` (длинная случайная строка) — он нужен для login/register.
4. Запустите приложение:
   ```bash
   npm run dev
   ```

При `VITE_ENABLE_DB_SYNC=1` фронтенд будет подтягивать **ваш шкаф и ваши образы** из БД при загрузке.

## 3) Авторизация (MVP)

- Страница `/auth`: регистрация (email/username/password) и вход (email или username + password)
- Сервер ставит JWT в httpOnly cookie (`AUTH_COOKIE_NAME`, по умолчанию `toptry_session`)
- Эндпойнты "свои вещи" и "создание образов" требуют авторизацию

## Важное

- **Ключ Gemini не хранится на клиенте** — все запросы идут через backend `/api/*`.
- Фото/вырезанные вещи при наличии MinIO сохраняются в объектное хранилище и раздаются через `/media/...`.