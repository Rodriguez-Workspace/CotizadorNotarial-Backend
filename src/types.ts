// ====================================================
// Interfaces compartidas entre todos los módulos
// ====================================================

export interface Env {
  /** KV Namespace — guarda { "email@gmail.com": "spreadsheetId" } */
  SHEETS_KV: KVNamespace;
  /** JSON string del Service Account de Google Cloud (configurado con wrangler secret) */
  GOOGLE_SERVICE_ACCOUNT: string;
  /** Firebase Project ID (ej: "cotizador-notarial-12345") */
  FIREBASE_PROJECT_ID: string;
}

export interface CotizacionSheet {
  fecha: string;
  referenciaInterna: string;
  tipoActo: string;
  moneda: string;
  cantidadInmuebles: number;
  costoNotarial: number;
  costoRegistral: number;
  totalPagar: number;
  notaria?: string;
}

export interface AuthenticatedUser {
  email: string;
  uid: string;
}
