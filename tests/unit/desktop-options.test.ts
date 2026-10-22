import { describe, expect, it } from 'vitest';
import { parseConfigFile, parseLaunchOptions } from '../../apps/desktop/src/options';

describe('desktop launch options', () => {
  it('server URL precedence: --server > env > veyrath.config.json > default', () => {
    const file = { serverUrl: 'ws://100.64.1.2:7777' };
    const env = { VEYRATH_SERVER_URL: 'ws://10.0.0.5:7777' };
    expect(parseLaunchOptions(['--server=ws://1.2.3.4:9000'], env, file).serverUrl).toBe(
      'ws://1.2.3.4:9000',
    );
    expect(parseLaunchOptions([], env, file).serverUrl).toBe('ws://10.0.0.5:7777');
    expect(parseLaunchOptions([], {}, file).serverUrl).toBe('ws://100.64.1.2:7777');
    expect(parseLaunchOptions([], {}).serverUrl).toBe('ws://127.0.0.1:7777');
  });

  it('rejects non-WebSocket server URLs and bad numbers', () => {
    expect(() => parseLaunchOptions(['--server=http://evil.example'], {})).toThrow();
    expect(() => parseLaunchOptions(['--instance=99'], {})).toThrow();
    expect(() => parseLaunchOptions(['--smoke=host', '--room=bad'], {})).toThrow();
  });
});

describe('veyrath.config.json', () => {
  it('reads serverUrl, tolerating a UTF-8 byte-order mark', () => {
    expect(parseConfigFile(undefined)).toBeUndefined();
    expect(parseConfigFile('{"serverUrl":"ws://100.64.1.2:7777/"}')).toEqual({
      serverUrl: 'ws://100.64.1.2:7777',
    });
    expect(parseConfigFile(String.fromCharCode(0xfeff) + '{"serverUrl":"wss://a.b:443"}')).toEqual({
      serverUrl: 'wss://a.b',
    });
    expect(parseConfigFile('{}')).toEqual({});
  });

  it('rejects malformed files instead of silently using a wrong server', () => {
    expect(() => parseConfigFile('not json')).toThrow();
    expect(() => parseConfigFile('[1]')).toThrow();
    expect(() => parseConfigFile('{"serverUrl": 5}')).toThrow();
    expect(() => parseConfigFile('{"serverUrl": "file:///c:/x"}')).toThrow();
  });
});
