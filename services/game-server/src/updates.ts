import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';

/** Only plain file names with the extensions electron-updater asks for. No paths, no traversal. */
const UPDATE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(yml|exe|blockmap)$/;

const CONTENT_TYPES: Record<string, string> = {
  yml: 'text/yaml; charset=utf-8',
  exe: 'application/octet-stream',
  blockmap: 'application/octet-stream',
};

export interface UpdateRequestInfo {
  file: string;
  bytes: number;
}

/**
 * Serves `GET /updates/<file>` from `updatesDir` for the desktop client's auto-updater. Returns
 * false when the request isn't for /updates/ so the caller can handle it. Files are streamed, so a
 * large installer download never blocks the simulation tick.
 */
export function serveUpdateFile(
  req: IncomingMessage,
  res: ServerResponse,
  updatesDir: string | undefined,
  onServe: (info: UpdateRequestInfo) => void,
): boolean {
  const url = req.url ?? '';
  if (!url.startsWith('/updates/')) return false;

  const notFound = (): true => {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return true;
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return notFound();
  if (!updatesDir) return notFound();

  let name: string;
  try {
    name = decodeURIComponent(url.slice('/updates/'.length).split('?')[0] ?? '');
  } catch {
    return notFound();
  }
  if (!UPDATE_FILE.test(name) || name.includes('..')) return notFound();

  const root = resolve(updatesDir);
  const file = join(root, name);
  if (!file.startsWith(root)) return notFound();
  let size: number;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return notFound();
    size = stat.size;
  } catch {
    return notFound();
  }

  const ext = name.slice(name.lastIndexOf('.') + 1);
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': 'no-store',
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  onServe({ file: name, bytes: size });
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return true;
}
