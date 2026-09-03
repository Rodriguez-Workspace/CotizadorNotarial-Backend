// Cloudflare Worker environment bindings (set in dashboard)
export interface Env {
  FIREBASE_PROJECT_ID: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: string;
  CORS_ORIGIN: string;
}

// Hono context variables set by the auth middleware
export type Variables = {
  userEmail: string;
  userId: string;
  notariaId: string;
  rol: string;
};

// ─── Firestore value types (REST API format) ───────────────────────────────

export interface FirestoreStringValue   { stringValue: string }
export interface FirestoreIntegerValue  { integerValue: string }
export interface FirestoreDoubleValue   { doubleValue: number }
export interface FirestoreBooleanValue  { booleanValue: boolean }
export interface FirestoreNullValue     { nullValue: null }
export interface FirestoreArrayValue    { arrayValue: { values?: FirestoreValue[] } }
export interface FirestoreMapValue      { mapValue: { fields?: FirestoreFields } }

export type FirestoreValue =
  | FirestoreStringValue
  | FirestoreIntegerValue
  | FirestoreDoubleValue
  | FirestoreBooleanValue
  | FirestoreNullValue
  | FirestoreArrayValue
  | FirestoreMapValue;

export interface FirestoreFields {
  [key: string]: FirestoreValue;
}

export interface FirestoreDocument {
  name: string;
  fields: FirestoreFields;
  createTime?: string;
  updateTime?: string;
}

// ─── Domain types (mirrors existing app models) ────────────────────────────

export interface Rango {
  min: number;
  max: number | null;
  valor: number | null;
}

export interface Requisito {
  id: string;
  texto: string;
}

export interface TarifarioActo {
  id: string;
  nombre: string;
  costo_tramite: number;
  tasa_registral_por_mil: number;
  rangos: Rango[];
  requisitos: Requisito[];
}

export interface NotariaPerfil {
  nombre_oficial: string;
  ruc?: string;
  color_marca: string;
  logo_url: string;
}

export interface CotizacionRow {
  fecha: string;
  referenciaInterna: string;
  tipoActo: string;
  moneda: string;
  cantidadInmuebles: number;
  costoNotarial: number;
  costoRegistral: number;
  totalPagar: number;
}
