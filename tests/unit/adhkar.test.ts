import { describe, expect, it } from 'vitest';
import { adhkarWindow, EXTRA_SEC, POST_SEC, PRAYER_HOLD_SEC } from '../../src/shared/adhkar.js';

describe('adhkar window', () => {
  it('stays quiet during the prayer hold', () => {
    expect(adhkarWindow('dhuhr', 0)).toBeNull();
    expect(adhkarWindow('fajr', PRAYER_HOLD_SEC - 1)).toBeNull();
  });

  it('shows post-salah after every prayer', () => {
    expect(adhkarWindow('asr', PRAYER_HOLD_SEC)?.key).toBe('postsalaah');
    expect(adhkarWindow('isha', PRAYER_HOLD_SEC + POST_SEC - 1)?.key).toBe('postsalaah');
  });

  it('continues with morning after Fajr and evening after Maghrib', () => {
    const afterPost = PRAYER_HOLD_SEC + POST_SEC;
    expect(adhkarWindow('fajr', afterPost)?.key).toBe('morning');
    expect(adhkarWindow('maghrib', afterPost + EXTRA_SEC - 1)?.key).toBe('evening');
    expect(adhkarWindow('fajr', afterPost + EXTRA_SEC)).toBeNull();
  });

  it('does not add a second set after Dhuhr, Asr or Isha', () => {
    expect(adhkarWindow('dhuhr', PRAYER_HOLD_SEC + POST_SEC)).toBeNull();
    expect(adhkarWindow('asr', PRAYER_HOLD_SEC + POST_SEC)).toBeNull();
    expect(adhkarWindow('isha', PRAYER_HOLD_SEC + POST_SEC)).toBeNull();
  });
});
