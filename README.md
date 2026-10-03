# Private Messeng — максимально простой вариант

## Что здесь есть
- регистрация по имени + паролю;
- вход без ввода email;
- список пользователей;
- личные сообщения;
- сообщения сохраняются в Supabase;
- realtime для новых сообщений;
- работает как обычная страница GitHub Pages.

## Один раз настроить Supabase

1. Открой свой проект Supabase.
2. Открой **SQL Editor** → **New query**.
3. Открой файл `setup.sql`, скопируй всё и нажми **Run**.
4. Открой **Authentication → Providers → Email**.
5. Выключи **Confirm email**.
6. Готово.

## GitHub Pages

В репозитории должны лежать минимум:
- `index.html`

`setup.sql` можно оставить в репозитории — он не запускается браузером.

GitHub:
Settings → Pages → Deploy from a branch → `main` → `/ (root)` → Save.

Через некоторое время GitHub даст ссылку вида:
https://ИМЯ.github.io/private-messeng/

Открываешь её на телефоне или ПК → создаёшь аккаунт → друзья создают свои аккаунты → выбираешь человека → пишешь.

## Важно
В `index.html` уже стоят публичные настройки Supabase из текущего проекта. Они предназначены для браузера. Секретный service_role key сюда НЕ вставляй.

Если меняешь Supabase-проект, замени `SUPABASE_URL` и `SUPABASE_ANON_KEY` в `index.html`.
