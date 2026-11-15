import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../src/domain/errors.js';
import { normalizeLabel } from '../../../src/services/label.js';

describe('normalizeLabel', () => {
  it('trims ASCII and Unicode whitespace', () => {
    expect(normalizeLabel('title', '  hello \n', 10)).toBe('hello');
    expect(normalizeLabel('title', '\u00a0\u2003hello\u00a0', 10)).toBe('hello');
  });

  it.each(['', '   ', '\u00a0\u2003'])('rejects blank value %j', (value) => {
    expect(() => normalizeLabel('title', value, 10)).toThrow(ValidationError);
  });

  it('accepts exactly the max length and rejects one more', () => {
    expect(normalizeLabel('title', 'a'.repeat(200), 200)).toHaveLength(200);
    expect(() => normalizeLabel('title', 'a'.repeat(201), 200)).toThrow(ValidationError);
  });

  it('measures length after trimming', () => {
    expect(normalizeLabel('title', `  ${'a'.repeat(200)}  `, 200)).toHaveLength(200);
  });

  it('names the field in the error message', () => {
    expect(() => normalizeLabel('name', ' ', 10)).toThrow(/name/);
    expect(() => normalizeLabel('name', 'x'.repeat(11), 10)).toThrow(/name/);
  });
});
