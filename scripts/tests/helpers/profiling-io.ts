// Shared in-memory IO stub for the profiling slot test suites.
// Lives under scripts/tests/helpers/ so vitest does not collect it as a
// suite and the coverage gate (which excludes scripts/tests/**) ignores it.

export interface StubFetchResponse {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
}

export type StubFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<StubFetchResponse>;

export interface StubIoOptions {
  files?: Record<string, string>;
  fetch?: StubFetch;
  tickMs?: number;
}

export interface StubIoHandle {
  io: Record<string, unknown>;
  stdout: string[];
  stderr: string[];
  writes: Record<string, string>;
  files: Map<string, string>;
  fetchCalls: Array<{ url: string; headers: Record<string, string> }>;
}

export function makeStubIo(options: StubIoOptions = {}): StubIoHandle {
  const files = new Map(Object.entries(options.files ?? {}));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const writes: Record<string, string> = {};
  const fetchCalls: Array<{ url: string; headers: Record<string, string> }> = [];
  let tick = 0;
  let rand = 0;

  const isDirectory = (path: string): boolean => {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    return [...files.keys()].some((key) => key.startsWith(prefix));
  };

  const listDir = (path: string): string[] => {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const names = new Set<string>();
    for (const key of files.keys()) {
      if (key.startsWith(prefix)) {
        names.add(key.slice(prefix.length).split('/')[0] as string);
      }
    }
    return [...names].sort();
  };

  const defaultFetch: StubFetch = async () => ({ ok: true });
  const fetchImpl = options.fetch ?? defaultFetch;

  const io = {
    write: (s: string) => {
      stdout.push(s);
    },
    writeErr: (s: string) => {
      stderr.push(s);
    },
    readFile: (p: string): string => {
      const content = files.get(p);
      if (content === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return content;
    },
    writeFile: (p: string, s: string) => {
      writes[p] = s;
      files.set(p, s);
    },
    fileExists: (p: string) => files.has(p) || isDirectory(p),
    listDir,
    isDirectory,
    statSize: (p: string) => (files.get(p) ?? '').length,
    copyFile: (src: string, dest: string) => {
      const content = files.get(src);
      if (content === undefined) {
        throw new Error(`ENOENT: ${src}`);
      }
      writes[dest] = content;
      files.set(dest, content);
    },
    readFileBytes: (p: string) => {
      const content = files.get(p);
      if (content === undefined) {
        throw new Error(`ENOENT: ${p}`);
      }
      return Buffer.from(content);
    },
    gzipSize: (buf: Buffer) => Math.ceil(buf.length / 2),
    fetch: async (url: string, init?: { headers?: Record<string, string> }) => {
      fetchCalls.push({ url, headers: init?.headers ?? {} });
      return fetchImpl(url, init);
    },
    now: () => {
      tick += options.tickMs ?? 10;
      return tick;
    },
    nowDate: () => new Date('2026-06-11T01:02:03.456Z'),
    randomBytes: (n: number) => {
      rand = (rand + 1) % 256;
      return Buffer.alloc(n, rand);
    },
    env: {},
  };

  return { io, stdout, stderr, writes, files, fetchCalls };
}
