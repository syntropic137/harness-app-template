'use client';

import { useState } from 'react';

type HelloPayload = {
  hello: string;
  service: string;
  ts: number;
};

export function HelloButton() {
  const [data, setData] = useState<HelloPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('http://localhost:3010/hello?name=docs-ui');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as HelloPayload;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-testid="exp12-hello" className="mt-6 rounded-lg border border-fd-border bg-fd-card p-4 text-fd-card-foreground">
      <p className="mb-3 text-sm">EXP-12 end-to-end probe: click to call example-http.</p>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="inline-flex items-center rounded-md bg-fd-primary px-3 py-2 text-sm font-medium text-fd-primary-foreground disabled:opacity-60"
      >
        {loading ? 'Calling...' : 'Call /hello'}
      </button>
      {data ? (
        <pre data-testid="exp12-result" className="mt-3 overflow-x-auto rounded bg-fd-background p-3 text-xs">
{JSON.stringify(data, null, 2)}
        </pre>
      ) : null}
      {error ? (
        <pre data-testid="exp12-error" className="mt-3 overflow-x-auto rounded bg-fd-background p-3 text-xs text-red-600">
{error}
        </pre>
      ) : null}
    </div>
  );
}
