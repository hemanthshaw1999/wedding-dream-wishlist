export class RequestError extends Error {
  readonly status: number;
  readonly fields: Record<string, string>;
  constructor(message: string, status: number, fields: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export async function requestJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store"
    });
  } catch {
    throw new RequestError("The server could not be reached. Your form is still here. Check your connection before retrying.", 0);
  }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new RequestError("The server returned an unreadable response. Refresh the workspace before repeating a change.", response.status); }
  if (!response.ok) {
    if (!data || typeof data !== "object" || !("error" in data) || !data.error ||
      typeof data.error !== "object" || !("message" in data.error) || typeof data.error.message !== "string") {
      throw new RequestError("The server returned an invalid error response. Refresh before repeating a change.", response.status);
    }
    const rawFields = "fields" in data.error ? data.error.fields : undefined;
    const fields = rawFields && typeof rawFields === "object"
      ? Object.fromEntries(Object.entries(rawFields).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {};
    throw new RequestError(data.error.message, response.status, fields);
  }
  return data as T;
}
