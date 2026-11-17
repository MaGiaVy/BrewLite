import { parseCorsOrigin, wildcardToRegExp } from './cors-origin.helper.js';

describe('cors-origin.helper', () => {
  describe('wildcardToRegExp', () => {
    it('matches scheme-qualified wildcard pattern like https://*.vercel.app', () => {
      const regex = wildcardToRegExp('https://*.vercel.app');

      expect(regex.test('https://brewlite.vercel.app')).toBe(true);
      expect(regex.test('https://brewlite-git-main.vercel.app')).toBe(true);
      expect(regex.test('http://brewlite.vercel.app')).toBe(false);
      expect(regex.test('https://vercel.app')).toBe(false);
      expect(regex.test('https://brewlite.vercel.app.evil.com')).toBe(false);
      expect(regex.test('https://evil.com/a.vercel.app')).toBe(false);
    });

    it('matches schemeless wildcard pattern like *.vercel.app', () => {
      const regex = wildcardToRegExp('*.vercel.app');

      expect(regex.test('https://brewlite.vercel.app')).toBe(true);
      expect(regex.test('http://brewlite.vercel.app')).toBe(true);
      expect(regex.test('brewlite.vercel.app')).toBe(true);
      expect(regex.test('https://brewlite.vercel.app.evil.com')).toBe(false);
      expect(regex.test('https://evil.com/a.vercel.app')).toBe(false);
    });
  });

  describe('parseCorsOrigin', () => {
    it('returns true when CORS_ORIGIN is undefined, empty, or *', () => {
      expect(parseCorsOrigin(undefined)).toBe(true);
      expect(parseCorsOrigin('')).toBe(true);
      expect(parseCorsOrigin('   ')).toBe(true);
      expect(parseCorsOrigin('*')).toBe(true);
    });

    it('returns exact string for a single non-wildcard origin', () => {
      expect(parseCorsOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    });

    it('returns RegExp for a single wildcard origin', () => {
      const parsed = parseCorsOrigin('https://*.vercel.app');
      expect(parsed).toBeInstanceOf(RegExp);
      expect((parsed as RegExp).test('https://preview-123.vercel.app')).toBe(true);
    });

    it('supports comma-separated mix of exact origins and wildcard patterns', () => {
      const parsed = parseCorsOrigin(
        'http://localhost:3000, https://*.vercel.app, *.brewlite.vn',
      );
      expect(Array.isArray(parsed)).toBe(true);
      const list = parsed as Array<string | RegExp>;
      expect(list).toHaveLength(3);
      expect(list[0]).toBe('http://localhost:3000');
      expect(list[1]).toBeInstanceOf(RegExp);
      expect((list[1] as RegExp).test('https://web.vercel.app')).toBe(true);
      expect(list[2]).toBeInstanceOf(RegExp);
      expect((list[2] as RegExp).test('https://app.brewlite.vn')).toBe(true);
    });
  });
});
