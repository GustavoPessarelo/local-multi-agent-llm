"use client";

export type RequestId = string | number;

export type CodexEnvelope = {
  id?: RequestId;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class CodexAppClient {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<RequestId, PendingRequest>();
  private listeners = new Set<(message: CodexEnvelope) => void>();

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(url = "ws://127.0.0.1:4502") {
    if (this.connected) return;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));
    socket.addEventListener("close", () => this.handleClose());

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("O Codex App Server não respondeu.")), 4_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Não foi possível conectar ao Codex App Server local."));
      }, { once: true });
    });

    await this.request("initialize", {
      clientInfo: { name: "indev", title: "InDev", version: "0.3.1" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    this.notify("initialized");
  }

  onMessage(listener: (message: CodexEnvelope) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = 30_000) {
    if (!this.connected) return Promise.reject(new Error("Codex App Server desconectado."));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tempo esgotado em ${method}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params: params ?? {} });
    });
  }

  notify(method: string, params?: unknown) {
    this.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  respond(id: RequestId, result: unknown) {
    this.send({ jsonrpc: "2.0", id, result });
  }

  disconnect() {
    this.socket?.close();
    this.socket = null;
  }

  private send(message: Record<string, unknown>) {
    if (!this.connected) throw new Error("Codex App Server desconectado.");
    this.socket?.send(JSON.stringify(message));
  }

  private handleMessage(raw: string) {
    let message: CodexEnvelope;
    try {
      message = JSON.parse(raw) as CodexEnvelope;
    } catch {
      return;
    }

    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "Erro no Codex App Server."));
      else pending.resolve(message.result);
      return;
    }

    this.listeners.forEach((listener) => listener(message));
  }

  private handleClose() {
    this.pending.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(new Error("A conexão com o Codex App Server foi encerrada."));
    });
    this.pending.clear();
    this.listeners.forEach((listener) => listener({ method: "indev/disconnected", params: {} }));
  }
}
