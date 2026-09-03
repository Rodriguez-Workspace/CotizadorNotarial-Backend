/**
 * firestore.utils.ts
 *
 * Helpers to convert between plain JavaScript objects and the Firestore
 * REST API's typed-value format.
 *
 * Firestore REST format example:
 *   { "fields": { "name": { "stringValue": "Juan" }, "age": { "integerValue": "30" } } }
 *
 * Plain JS object:
 *   { name: "Juan", age: 30 }
 */

import type { FirestoreFields, FirestoreValue } from '../types';

// ─── Firestore → Plain JS ──────────────────────────────────────────────────

/** Recursively converts a Firestore typed value to a plain JS value */
function fromFirestoreValue(value: FirestoreValue): unknown {
  if ('stringValue'  in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue'  in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue'    in value) return null;
  if ('arrayValue'   in value) {
    return (value.arrayValue.values ?? []).map(fromFirestoreValue);
  }
  if ('mapValue' in value) {
    return fromFirestoreFields(value.mapValue.fields ?? {});
  }
  return null;
}

/** Converts a Firestore `fields` map into a plain JS object */
export function fromFirestoreFields(fields: FirestoreFields): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = fromFirestoreValue(value);
  }
  return result;
}

// ─── Plain JS → Firestore ──────────────────────────────────────────────────

/** Converts a plain JS value to a Firestore typed value */
function toFirestoreValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: toFirestoreFields(value as Record<string, unknown>) } };
  }
  return { stringValue: String(value) };
}

/** Converts a plain JS object to a Firestore `fields` map */
export function toFirestoreFields(obj: Record<string, unknown>): FirestoreFields {
  const fields: FirestoreFields = {};
  for (const [key, value] of Object.entries(obj)) {
    fields[key] = toFirestoreValue(value);
  }
  return fields;
}
