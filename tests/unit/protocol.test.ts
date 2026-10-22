import {
  LIMITS,
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage,
} from '@veyrath/protocol';
import { describe, expect, it } from 'vitest';

const parse = (value: unknown) => parseClientMessage(JSON.stringify(value));

describe('parseClientMessage', () => {
  it('accepts every well-formed message type', () => {
    expect(parse({ t: 'input', seq: 1, moveX: 1, moveY: -0.5, attack: false }).ok).toBe(true);
    expect(parse({ t: 'ping', id: 3, clientTime: 1234.5 }).ok).toBe(true);
    expect(parse({ t: 'create', v: PROTOCOL_VERSION, name: 'Ash Ka-1' }).ok).toBe(true);
    expect(parse({ t: 'join', v: 1, name: 'Bo', room: 'K7QPX' }).ok).toBe(true);
    expect(
      parse({
        t: 'rejoin',
        v: 1,
        room: 'K7QPX',
        playerId: 'p_0a1b2c3d',
        token: '0123456789abcdef0123456789abcdef',
      }).ok,
    ).toBe(true);
    expect(parse({ t: 'leave' }).ok).toBe(true);
  });

  it('returns only known fields', () => {
    const result = parse({ t: 'input', seq: 1, moveX: 0, moveY: 0, attack: true, hp: 9999 });
    expect(result).toEqual({
      ok: true,
      msg: { t: 'input', seq: 1, moveX: 0, moveY: 0, attack: true },
    });
  });

  it('rejects malformed JSON, non-objects and unknown types', () => {
    expect(parseClientMessage('{nope').ok).toBe(false);
    expect(parse(null).ok).toBe(false);
    expect(parse([1, 2]).ok).toBe(false);
    expect(parse('input').ok).toBe(false);
    expect(parse({ t: 'teleport', x: 1 }).ok).toBe(false);
    expect(parse({}).ok).toBe(false);
  });

  it('rejects oversized messages before parsing', () => {
    const big = JSON.stringify({ t: 'leave', pad: 'x'.repeat(LIMITS.maxClientMessageBytes) });
    expect(parseClientMessage(big)).toEqual({ ok: false, error: 'message too large' });
  });

  it.each([
    [{ t: 'input', seq: -1, moveX: 0, moveY: 0, attack: false }],
    [{ t: 'input', seq: 1.5, moveX: 0, moveY: 0, attack: false }],
    [{ t: 'input', seq: 2 ** 31, moveX: 0, moveY: 0, attack: false }],
    [{ t: 'input', seq: '1', moveX: 0, moveY: 0, attack: false }],
    [{ t: 'input', seq: 1, moveX: 1.01, moveY: 0, attack: false }],
    [{ t: 'input', seq: 1, moveX: 0, moveY: -2, attack: false }],
    [{ t: 'input', seq: 1, moveX: '0', moveY: 0, attack: false }],
    [{ t: 'input', seq: 1, moveX: 0, moveY: 0, attack: 1 }],
    [{ t: 'input', seq: 1, moveX: 0, moveY: 0 }],
  ])('rejects invalid input %j', (msg) => {
    expect(parse(msg).ok).toBe(false);
  });

  it('rejects non-finite numbers smuggled as JSON', () => {
    expect(
      parseClientMessage('{"t":"input","seq":1,"moveX":1e999,"moveY":0,"attack":false}').ok,
    ).toBe(false);
    expect(parseClientMessage('{"t":"ping","id":1,"clientTime":-1e999}').ok).toBe(false);
  });

  it.each(['', ' padded', 'x'.repeat(17), 'bad\nname', '<script>', 'a\u0000b'])(
    'rejects invalid player name %j',
    (name) => {
      expect(parse({ t: 'create', v: 1, name }).ok).toBe(false);
    },
  );

  it.each(['k7qpx', 'K7QP', 'K7QPXX', 'O0I1L', 123])('rejects invalid room code %j', (room) => {
    expect(parse({ t: 'join', v: 1, name: 'Bo', room }).ok).toBe(false);
  });

  it('rejects malformed rejoin credentials', () => {
    const base = { t: 'rejoin', v: 1, room: 'K7QPX' };
    expect(parse({ ...base, playerId: 'admin', token: '0'.repeat(32) }).ok).toBe(false);
    expect(parse({ ...base, playerId: 'p_0a1b2c3d', token: 'short' }).ok).toBe(false);
  });
});

describe('parseServerMessage', () => {
  it('tolerates garbage without throwing', () => {
    expect(parseServerMessage('nope')).toBeNull();
    expect(parseServerMessage('{"t":"snapshot"}')).toBeNull();
    expect(parseServerMessage('{"t":"hack"}')).toBeNull();
    expect(parseServerMessage('{"t":"left"}')).toEqual({ t: 'left' });
  });
});
