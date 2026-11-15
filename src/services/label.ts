import { ValidationError } from '../domain/errors.js';

/**
 * Normalization for short labels (note titles, team names): strip leading and
 * trailing whitespace with String.prototype.trim (includes Unicode whitespace).
 * The trimmed value is what is stored and returned. Rejects values that are
 * empty after trimming, and values longer than `max` characters after trimming.
 */
export function normalizeLabel(field: string, value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new ValidationError(`${field} must not be blank`);
  if (trimmed.length > max) {
    throw new ValidationError(`${field} must not have more than ${max} characters`);
  }
  return trimmed;
}
