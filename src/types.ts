export interface Env {
  SHEETS_KV: KVNamespace;
  GOOGLE_SERVICE_ACCOUNT: string;
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
