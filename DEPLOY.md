# Despliegue en producción (GoDaddy + VPS)

**Objetivo:** dejar la aplicación en la web con el dominio de GoDaddy apuntando a un VPS en producción, con HTTPS y comprobaciones finales.

El backend es **Node.js + Express** con **PostgreSQL**. En producción suele usarse **Supabase** (solo como alojamiento de Postgres y panel SQL): copia la **URI de conexión** en `DATABASE_URL` (ver `backend/.env.example`). La API y el frontend compilado pueden servirse **desde el mismo proceso** (recomendado).

**Autenticación:** la app sigue usando **JWT propio** (`jsonwebtoken`) y contraseñas en la tabla `users`; **no** está integrada con Supabase Auth. Los roles (`owner`, `admin`, `member`) son los de tu modelo multi-tenant.

**Migración desde SQLite (opcional):** solo si ya tenías datos en `backend/data/kovo.sqlite` y quieres pasarlos a Postgres. Ejecuta una vez (con `DATABASE_URL` al Postgres vacío o compatible) `npm run migrate:sqlite --prefix backend` (requiere `better-sqlite3` en `devDependencies`). Si **no** existe ese archivo SQLite, no hace falta este paso: al arrancar el backend, `initDb` crea el esquema y los datos mínimos en Postgres; el script de migración termina sin error y no hace nada si falta `kovo.sqlite`.

Guía alineada con estos pasos: **1)** DNS GoDaddy → **2)** VPS (Node, build, `.env`, arranque) → **3)** Nginx + SSL → **4)** Cloudflare opcional → **5)** Vercel solo si separas el front → **6)** verificación → **7)** pruebas finales.

---

## 1. DNS en GoDaddy

1. Entra en **DNS** del dominio en GoDaddy.
2. **Registro A** para `@` (o nombre en blanco) → IP pública del VPS.
3. Para **www**: otro **A** a la misma IP, o **CNAME** `www` → `@` si el panel lo permite.
4. Propagación: puede tardar desde minutos hasta 48 h.

---

## 2. Servidor (VPS): Node y Nginx

### Node.js

**Opción rápida (Ubuntu/Debian)** — puede instalar una versión antigua de Node; comprueba con `node -v` que sea compatible con el proyecto (idealmente **v18+**):

```bash
sudo apt update
sudo apt install -y nodejs npm
```

**Recomendado para producción:** instalar una **LTS actual** con [NodeSource](https://github.com/nodesource/distributions) o [nvm](https://github.com/nvm-sh/nvm) (`nvm install --lts`), porque el paquete `nodejs` del sistema a veces queda desactualizado.

### Nginx

```bash
sudo apt update
sudo apt install -y nginx
```

### Código, dependencias y build

En el VPS (ajusta la ruta):

```bash
cd /var/www   # o la carpeta que uses
# git clone ...  o sube el proyecto por scp/rsync
cd "App kovo clean"

npm install --prefix frontend
npm install --prefix backend
npm run build
```

### Variables de entorno

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Mínimo en producción:

```env
DATABASE_URL=postgresql://postgres.[ref]:[PASSWORD]@aws-0-....pooler.supabase.com:6543/postgres
PORT=3000
HOST=0.0.0.0
JWT_SECRET=<genera-un-secreto-largo-y-aleatorio>
CORS_ORIGINS=https://tudominio.com,https://www.tudominio.com
TRUST_PROXY=1
```

Postgres **local** sin TLS: añade `DB_SSL=false`. Supabase casi siempre requiere SSL (comportamiento por defecto del pool).

- Sustituye `tudominio.com` por tu dominio real (con `https://`, sin barra final).
- Si solo usas un host (sin www), pon solo ese en `CORS_ORIGINS`.

### Arranque del backend

Desde la **raíz del proyecto** (donde está el `package.json` que ejecuta el backend):

```bash
npm start
```

O desde la carpeta `backend`:

```bash
node server.js
```

**Producción:** mejor **PM2** para que el proceso se reinicie solo:

```bash
sudo npm install -g pm2
cd /ruta/al/proyecto
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup   # sigue las instrucciones que imprime
```

Prueba en el VPS: `curl -sI http://127.0.0.1:3000/` → debería responder **200** (con el build del front ya generado).

---

## 3. Nginx como proxy inverso y HTTPS

1. Copia la plantilla y edita el dominio:

   ```bash
   sudo cp deploy/nginx-site.conf.example /etc/nginx/sites-available/kovo
   sudo nano /etc/nginx/sites-available/kovo
   ```

2. La primera vez **puedes** dejar solo el bloque `listen 80` sin SSL, enlazar el sitio y usar Certbot para que genere certificados y complete la config:

   ```bash
   sudo ln -s /etc/nginx/sites-available/kovo /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d tudominio.com -d www.tudominio.com
   ```

Certbot suele ajustar `ssl_certificate` y renovación automática (`certbot renew` vía cron/systemd).

---

## 4. Cloudflare (opcional)

1. Crea cuenta, añade el dominio y cambia en GoDaddy los **nameservers** a los que indique Cloudflare.
2. DNS en Cloudflare: registros **A** a la IP del VPS (proxy naranja si quieres su CDN/WAF).
3. **SSL/TLS**: modo **Full (strict)** si el origen tiene certificado válido (Let’s Encrypt en Nginx).
4. Si activas proxy naranja, mantén **`TRUST_PROXY=1`** en el backend.

---

## 5. Frontend en Vercel (opcional, desaconsejado para el flujo simple)

El despliegue **recomendado** es **todo en el VPS**: un solo `npm run build` y Node sirve `frontend/dist` + `/api`.

Si aun así separas el front en **Vercel** (repositorio GitHub/GitLab, etc.):

1. En Vercel, variable **`VITE_API_URL`**: URL base donde está la API (ej. `https://tudominio.com`, **sin** barra final). El front llamará a `VITE_API_URL` + `/api/...`.
2. En **`backend/.env` del VPS**, incluye en **`CORS_ORIGINS`** el origen del front en Vercel, por ejemplo `https://tu-app.vercel.app`.
3. **`JWT_SECRET`** y **`DATABASE_URL`** siguen **solo en el servidor** donde corre Node: **no** hace falta poner `JWT_SECRET` ni la URI de Postgres en Vercel. El front en Vercel solo necesita `VITE_API_URL` hacia tu API.

### Shopify OAuth: callback, CORS y Render

- **`GET /api/shopify/callback`** es **público** (sin JWT): Shopify redirige el navegador ahí. **CORS no bloquea** esa petición (no es un `fetch` con preflight desde el admin de Shopify).
- **`CORS_ORIGINS`** sí importa para los **`fetch`** del front (login, “Conectar Shopify”, etc.). Si **`SHOPIFY_APP_URL`** o **`SHOPIFY_REDIRECT_URI`** son URLs `https://…`, el backend **añade automáticamente** el **origen** de esa URL a los orígenes CORS permitidos (además de `CORS_ORIGINS` y localhost). Conviene seguir listando explícitamente el dominio del front (p. ej. `https://kovo.services`) en **`CORS_ORIGINS`** si ahí se sirve el SPA.
- **Sitio estático + API en otro host (p. ej. Render Static + Web Service):** si `https://kovo.services` solo sirve archivos estáticos, **`https://kovo.services/api/shopify/callback` no llegará a Node**. Registra en Shopify Partner la URL de callback del **servicio donde corre Express** (p. ej. `https://tu-servicio.onrender.com/api/shopify/callback`) y define **`SHOPIFY_REDIRECT_URI`** igual. Usa **`SHOPIFY_APP_URL=https://kovo.services`** (u otro origen del front) para que, tras el OAuth, el redirect final vaya a `/canales` en el dominio correcto.
- Evita reglas de redirect del CDN/proxy que capturen **`/api/*`** y las manden al bucket estático en lugar del proceso Node.

---

## 6. Verificación en producción

- Abre `https://tudominio.com` y comprueba login y **rutas protegidas** de React tras autenticarte (recargar una subruta no debe dar 404 si Nginx hace proxy a Node).
- Comprueba la **API REST** (respuestas JSON; sin token puede devolver **401**, lo cual confirma que el backend responde). Los datos viven en **PostgreSQL** (p. ej. Supabase): revisa filas en el panel **Table Editor** o exporta backups desde Supabase.
- **Lighthouse** (Chrome DevTools) para rendimiento, HTTPS y buenas prácticas.
- Planifica **copias de seguridad** del proyecto Postgres (Supabase: backups automáticos según plan; también puedes exportar con `pg_dump` si tienes acceso directo).

---

## 7. Pruebas finales

- **Integración front + back:** registro/login, pantallas que llamen a la API, cierre de sesión.
- **SSL:** HTTPS sin advertencias; certificado válido y renovación de Certbot operativa.
- **Variables de entorno:** en el **VPS**, `backend/.env` completo (`JWT_SECRET`, `CORS_ORIGINS`, `TRUST_PROXY`). Si usas Vercel, solo variables de **build** del front (p. ej. `VITE_API_URL`), nunca sustituir el backend ni la base de datos.

---

## 8. Checklist rápido (salir a producción)

1. **`backend/.env`:** `DATABASE_URL`, `JWT_SECRET` fuerte, `PORT`/`HOST=0.0.0.0`, `CORS_ORIGINS` con cada origen HTTPS del front (sin barra final; `SHOPIFY_APP_URL`/`SHOPIFY_REDIRECT_URI` https añaden su origen automáticamente), `TRUST_PROXY=1` detrás de Nginx/Cloudflare.
2. **Build:** en la raíz del repo, `npm install --prefix frontend`, `npm install --prefix backend`, `npm run build` (genera `frontend/dist`; Node lo sirve al arrancar).
3. **Proceso:** `pm2 start deploy/ecosystem.config.cjs`, `pm2 save`, `pm2 startup` (o prueba puntual con `npm start` desde la raíz).
4. **Nginx:** sitio con `proxy_pass` al mismo puerto que `PORT` (3000 por defecto); Certbot para HTTPS.
5. **Front y API en el mismo dominio** (recomendado): no hace falta `VITE_API_URL` en el build. **Si el front vive en otro host:** define `VITE_API_URL` en `frontend/.env.production` (base `https://…` sin barra final) y añade ese origen del front en `CORS_ORIGINS`.
6. **Comprobación:** `curl -sI https://tudominio.com/api/health` (o la ruta que expongas), login, recarga en una ruta interna del SPA (no 404).

---

## Resolución de problemas

| Síntoma | Qué revisar |
|--------|--------------|
| CORS en el navegador | `CORS_ORIGINS` debe incluir el **origen exacto** del front (https + host + sin path). También se añade el origen de `SHOPIFY_APP_URL` / `SHOPIFY_REDIRECT_URI` si son URLs `https://…`. |
| Shopify OAuth: `?shopify=error` y en el servidor no hay logs del callback | Suele ser **callback que no llega a Node** (dominio solo estático) o **`SHOPIFY_REDIRECT_URI`** distinta de la URL en Partner Dashboard. Prueba `curl -sI "https://TU_HOST/api/shopify/callback"` desde fuera: debe responder el backend (302/400), no el HTML del SPA. |
| 502 Bad Gateway | Node caído (`pm2 status`), puerto distinto de `proxy_pass`, firewall. |
| 404 al recargar una ruta | Nginx debe proxy a Node (esta app sirve `index.html` para el SPA); no sirvas solo archivos estáticos sin fallback. |
| IP incorrecta del cliente | `TRUST_PROXY=1` y cabeceras `X-Forwarded-*` en Nginx (ya en la plantilla). |
