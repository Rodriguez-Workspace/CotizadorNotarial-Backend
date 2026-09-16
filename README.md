# CotizadorNotarial — Backend

Cloudflare Worker que expone la API REST del sistema SaaS de cotización notarial. Construido con [Hono](https://hono.dev/) y TypeScript, sin dependencias de Node.js — corre en el edge de Cloudflare.

---

## Stack

| Tecnología | Uso |
|---|---|
| **Cloudflare Workers** | Runtime serverless en el edge |
| **Hono** | Framework HTTP minimalista para Workers |
| **TypeScript** | Lenguaje principal |
| **Firebase Auth** | Verificación de ID Tokens (WebCrypto + JWK) |
| **Google Firestore REST API** | Base de datos (sin SDK — fetch puro) |
| **Google Sheets API v4** | Historial de cotizaciones por abogado |
| **Google OAuth2 (Service Account)** | Autenticación server-to-server a Google APIs |

---

## Arquitectura

```
Request
  │
  ├─ CORS Middleware          (origin restringido a CORS_ORIGIN)
  ├─ Security Headers         (X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
  ├─ Secrets Guard            (falla rápido si faltan variables de entorno)
  ├─ Auth Middleware          (verifica Firebase ID Token con RSA/JWK de Google)
  │
  └─ Routes
      ├─ GET  /api/tenant                Perfil de notaría + rol del usuario
      ├─ POST /api/tenant/spreadsheet    Registra spreadsheetId del abogado
      ├─ GET  /api/tarifario             Lista de actos con tarifas
      ├─ GET  /api/variables             UIT y tipo de cambio actuales
      ├─ POST /api/cotizacion            Guarda cotización en Google Sheets
      └─ GET  /api/historial             Historial paginado del abogado
```

---

## Estructura de Archivos

```
src/
├── index.ts                    # Entry point: CORS, headers de seguridad, rutas
├── types.ts                    # Interfaces globales (Env, Variables, modelos de dominio)
├── middleware/
│   └── auth.middleware.ts      # Verificación de Firebase ID Token (sin Firebase Admin SDK)
├── routes/
│   ├── tenant.route.ts         # Perfil institucional y registro de spreadsheet
│   ├── tarifario.route.ts      # Tarifario de actos notariales
│   ├── variables.route.ts      # UIT y tipo de cambio
│   ├── cotizacion.route.ts     # Guardar cotizaciones en Sheets
│   └── historial.route.ts      # Consulta paginada del historial
├── services/
│   ├── firestore.service.ts    # GET/SET/UPDATE sobre Firestore REST API
│   └── sheets.service.ts       # Append y lectura de Google Sheets
└── utils/
    ├── jwt.utils.ts            # JWT de Service Account + cache de token OAuth2
    └── firestore.utils.ts      # Serialización/deserialización de tipos Firestore
```

---

## Variables de Entorno (Cloudflare Secrets)

Configurar en el dashboard de Cloudflare Workers → Settings → Variables:

| Variable | Descripción | Ejemplo |
|---|---|---|
| `FIREBASE_PROJECT_ID` | ID del proyecto Firebase | `cotizacionesnotariales` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Email de la Service Account | `worker@proyecto.iam.gserviceaccount.com` |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Clave privada PEM de la SA (con `\n` literales) | `-----BEGIN PRIVATE KEY-----\n...` |
| `CORS_ORIGIN` | URL exacta del frontend permitido | `https://cotizador.pages.dev` |

> ⚠️ **Nunca** guardes estos valores en el código ni en el repositorio. Usar siempre `wrangler secret put`.

---

## Desarrollo Local

```bash
npm install
npm run dev          # wrangler dev — servidor local en http://localhost:8787
npm run type-check   # tsc --noEmit — verificación de tipos sin compilar
```

Para desarrollo local, crear un archivo `.dev.vars` en la raíz (no commitear):
```ini
FIREBASE_PROJECT_ID=cotizacionesnotariales
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=...
CORS_ORIGIN=http://localhost:4200
```

---

## Despliegue

```bash
npm run build    # esbuild — compila TypeScript a un único bundle JS
npm run deploy   # wrangler deploy — sube el Worker a Cloudflare
```

---

## Endpoints

### `GET /`
Health check público. No requiere autenticación.

**Response:** `200 { "status": "ok", "service": "cotizador-notarial-backend" }`

---

### `GET /api/tenant`
Retorna el perfil institucional de la notaría del usuario autenticado, su rol y su `spreadsheetId`.

**Headers:** `Authorization: Bearer {firebase_id_token}`

**Response `200`:**
```json
{
  "notariaId": "notaria-cruzado",
  "rol": "abogado",
  "perfil": {
    "nombre_oficial": "Notaría Cruzado",
    "ruc": "20123456789",
    "color_marca": "#1e40af",
    "logo_url": "https://..."
  },
  "spreadsheetId": "1BxiMVs0XRA...",
  "serviceAccountEmail": "worker@proyecto.iam.gserviceaccount.com"
}
```

---

### `POST /api/tenant/spreadsheet`
Registra el `spreadsheetId` de Google Sheets del abogado en Firestore.

**Body:**
```json
{ "spreadsheetId": "1BxiMVs0XRA..." }
```

**Validación:** El ID debe coincidir con el patrón `/^[a-zA-Z0-9_-]{20,80}$/`.

---

### `GET /api/tarifario`
Retorna la lista completa de actos notariales con sus tarifas, ordenados alfabéticamente.

**Response `200`:**
```json
{
  "actos": [
    {
      "id": "COMPRAVENTA",
      "nombre": "Compraventa de Inmueble",
      "costo_tramite": 250,
      "tasa_registral_por_mil": 3.0,
      "rangos": [
        { "min": 0, "max": 50000, "valor": 800 },
        { "min": 50000, "max": null, "valor": 1500 }
      ],
      "requisitos": [
        { "id": "req_001", "texto": "DNI del comprador" }
      ]
    }
  ]
}
```

---

### `GET /api/variables`
Retorna la UIT y el tipo de cambio actuales.

**Response `200`:**
```json
{
  "UIT": 5350,
  "compra": 3.72,
  "venta": 3.75,
  "moneda": "USD",
  "origen": "SUNAT",
  "fecha_sunat": "2024-03-15"
}
```

---

### `POST /api/cotizacion`
Guarda una o más cotizaciones en la hoja de cálculo Google Sheets del abogado. Máximo 50 items por request.

**Body:**
```json
{
  "items": [
    {
      "fecha": "2024-03-15T10:30:00.000Z",
      "referenciaInterna": "Juan Perez - K1234",
      "tipoActo": "Compraventa de Inmueble",
      "moneda": "SOLES",
      "cantidadBienes": 1,
      "costoNotarial": 1200,
      "costoRegistral": 450,
      "totalPagar": 1650
    }
  ]
}
```

**Response `200`:** `{ "success": true, "spreadsheetId": "..." }`

---

### `GET /api/historial?limit=100&offset=0`
Retorna el historial paginado de cotizaciones del abogado. Máximo 500 filas por request.

**Response `200`:**
```json
{
  "data": [ /* CotizacionRow[] */ ],
  "hasMore": false
}
```

---

## Seguridad

### Autenticación
- Cada request a `/api/*` debe incluir un Firebase ID Token válido en `Authorization: Bearer`.
- El middleware verifica la firma RSA del token con las claves públicas de Google (JWK).
- Valida `exp` (expiración), `aud` (audience = `FIREBASE_PROJECT_ID`), `iss` (issuer).
- Verifica adicionalmente en Firestore que el usuario esté en `usuarios_autorizados` con `estado: activo`.

### CORS
- Solo se acepta el origen definido en `CORS_ORIGIN`. Cualquier otro origen recibe `403`.
- Métodos permitidos: `GET`, `POST`, `OPTIONS`.

### Headers de Seguridad
Todas las respuestas incluyen:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`

### Rate Limiting
- Límite de ~30 requests por minuto por IP aplicado en el middleware.
- Cloudflare WAF proporciona protección adicional a nivel de infraestructura.

### Aislamiento Multi-Tenant
- El `notariaId` del usuario se extrae del token verificado — nunca del body o query.
- Cada ruta opera exclusivamente sobre datos de la notaría del usuario autenticado.
