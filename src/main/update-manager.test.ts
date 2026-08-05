import { describe, expect, it } from 'vitest';
import { MONITOR_UPDATE_FEED } from './update-manager.js';

describe('monitor update feed', () => {
  it('publishes only the Apple Silicon stable channel', () => {
    expect(MONITOR_UPDATE_FEED).toContain('/geo-publisher-monitor/releases/channels/stable/mac-arm64');
    expect(MONITOR_UPDATE_FEED).not.toContain('linux');
    expect(MONITOR_UPDATE_FEED).not.toContain('win');
  });
});
