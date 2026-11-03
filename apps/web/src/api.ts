/** JSON fetch that throws the server's error message on failure. */
export async function api<T>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: init.body ? { "Content-Type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Something went wrong (${res.status}).`);
  return data as T;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
