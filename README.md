# Cotizador Notarial — Backend (Cloudflare Worker)

API REST que actúa como proxy seguro entre el frontend Angular y los servicios de Google (Firestore, Sheets, SUNAT). Construido con [Hono](https://hono.dev/) sobre [Cloudflare Workers](https://workers.cloudflare.com/).

## Requisitos Previos

- **Node.js** ≥ 18
- **npm** ≥ 9
- Cuenta de Cloudflare con Workers habilitado
- Service Account de Google con acceso a Firestore y Google Sheets
- Proyecto Firebase configurado

## Instalación

```bash
cd CotizadorNotarial-Backend
npm install
```

## Desarrollo Local

```bash
npm run dev
```

Esto inicia `wrangler dev` con un servidor local en `http://localhost:8787`.

> **Nota:** Para desarrollo local necesitas configurar las variables de entorno en un archivo `.dev.vars`:
>
> ```
> FIREBASE_PROJECT_ID=firabaseprojectid
> GOOGLE_SERVICE_ACCOUNT_EMAIL=tu-sa@proyecto.iam.gserviceaccount.com
> GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
> CORS_ORIGIN=http://localhost:4200
> ```

## Despliegue

```bash
npm run deploy
```

### Configuración de Secrets (Cloudflare Dashboard)

En **Workers & Pages → Settings → Variables and Secrets**, configurar:

| Secret | Descripción | Ejemplo |
|---|---|---|
| `FIREBASE_PROJECT_ID` | ID del proyecto Firebase | `firabaseprojectid` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Email de la Service Account | `sa@proyecto.iam.gserviceaccount.com` |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Clave privada PEM completa | `-----BEGIN PRIVATE KEY-----\n...` |
| `CORS_ORIGIN` | Dominio del frontend (obligatorio) | `https://tu-dominio.pages.dev` |

## Endpoints API

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | `/` | No | Health check |
| `GET` | `/api/tenant` | Bearer | Perfil de la notaría del usuario |
| `POST` | `/api/tenant/spreadsheet` | Bearer | Asociar Google Sheet al usuario |
| `GET` | `/api/tarifario` | Bearer | Tabla de actos y precios |
| `GET` | `/api/variables` | Bearer | UIT y tipo de cambio SUNAT |
| `POST` | `/api/cotizacion` | Bearer | Guardar cotización(es) |
| `GET` | `/api/historial?limit=N&offset=M` | Bearer | Historial paginado |

### Autenticación

Todas las rutas bajo `/api/*` requieren un header `Authorization: Bearer <Firebase_ID_Token>`.

## Estructura del Proyecto

```
src/
├── index.ts                  # Entry point, CORS, security headers, routing
├── types.ts                  # Interfaces y tipos
├── middleware/
│   └── auth.middleware.ts    # Validación de Firebase ID Token
├── routes/
│   ├── tenant.route.ts       # Perfil notaría
│   ├── tarifario.route.ts    # Actos/precios
│   ├── variables.route.ts    # UIT/TC
│   ├── cotizacion.route.ts   # Guardar cotización
│   └── historial.route.ts    # Leer historial
├── services/
│   ├── firestore.service.ts  # REST API Firestore
│   └── sheets.service.ts     # Google Sheets API
└── utils/
    └── jwt.utils.ts          # JWT signing para SA
```

## Type-Check

```bash
npm run build     # tsc --noEmit
```

## Seguridad

- **CORS**: Origen restringido (requiere `CORS_ORIGIN` configurado, sin fallback `*`)
- **Auth**: Firebase ID Token validado contra claves JWK de Google
- **Headers**: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
- **Input Validation**: Cast explícito de campos, validación regex de spreadsheetId
- **Secrets Guard**: Fail-fast si faltan secrets en lugar de timeout de 30s
