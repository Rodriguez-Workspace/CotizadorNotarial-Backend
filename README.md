# Cotizador Notarial — Backend (Cloudflare Worker)

Backend API del sistema de cotización notarial. Cloudflare Worker escrito en TypeScript con Hono.

## Stack
- **Runtime:** Cloudflare Workers
- **Router:** Hono v4
- **Auth:** Firebase ID Token (JWT verification via WebCrypto)
- **Data:** Google Sheets API v4 (via Service Account — sin expiración de 1 hora)
- **Cache:** Cloudflare KV (spreadsheetId por usuario)

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/cotizaciones` | Guarda cotización en el Sheet del abogado |
| `GET` | `/api/historial?limit=100&offset=0` | Obtiene historial paginado |

Todos los endpoints `/api/*` requieren `Authorization: Bearer <firebase_id_token>`.

---

## Setup inicial (OBLIGATORIO antes de usar)

### 1. Google Cloud — Service Account

1. Ir a https://console.cloud.google.com
2. Crear proyecto: `cotizador-notarial-backend`
3. Habilitar **Google Sheets API** y **Google Drive API**
4. **APIs y Servicios → Credenciales → Crear cuenta de servicio**
   - Nombre: `cotizador-worker`
   - Descargar la clave como JSON
5. **⚠️ NUNCA subas este JSON a Git**

### 2. Cloudflare — Autenticación

```bash
npx wrangler login
```

### 3. Cloudflare KV Namespace

```bash
npx wrangler kv namespace create SHEETS_KV
```

Copiar el `id` que imprime y pegarlo en `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "SHEETS_KV"
id = "PEGAR_AQUI_EL_ID"
```

### 4. Configurar wrangler.toml

Editar `wrangler.toml` y reemplazar:
```toml
[vars]
FIREBASE_PROJECT_ID = "cotizacionesnotariales"  # ← tu Firebase Project ID
```

### 5. Subir el Service Account como Secret

```bash
# Pegar el contenido COMPLETO del JSON descargado de Google Cloud
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT
```

---

## Desarrollo local

```bash
npm install
npm run dev
# Worker disponible en http://localhost:8787
```

## Deploy a producción

```bash
npm run deploy
# Output: https://cotizador-worker.TU_SUBDOMINIO.workers.dev
```

Después del deploy, copiar la URL y pegarla en el frontend:
`src/environments/environment.prod.ts` → `workerUrl`
