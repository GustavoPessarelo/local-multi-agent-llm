const toolServer = "http://127.0.0.1:4502";

export async function requestToolService<T>(path: string, body?: unknown) {
  const response = await fetch(`${toolServer}${path}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "A tool local falhou.");
  return payload as T;
}
