// Durable Object — live per-room state (WebSocket + match broadcast).
//
// HARD REQUIREMENTS:
//  - SQLite storage backend (migrations `new_sqlite_classes` in wrangler.toml).
//  - WebSocket Hibernation API: we use `state.acceptWebSocket()` + the
//    `webSocketMessage/Close/Error` handlers, so the DO uses no compute while
//    the room is idle (connections "hibernate").
//
// Architecture (D1 = source of truth, DO = live):
//  - swipes and matches are persisted in D1 by the Worker.
//  - the DO only holds the WebSocket connections and fans out ("broadcast")
//    when the Worker sends a match event → clients get it live, no refresh.

import type { Env } from "../types";

export class Room {
  private state: DurableObjectState;

  // env is received but unused here: D1 is the source of truth (writes happen in
  // the Worker); the DO only does WebSocket fan-out.
  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    // WebSocket upgrade (the client connects to /api/rooms/:id/ws).
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      // Hibernation: the runtime manages the connection; we keep no references.
      this.state.acceptWebSocket(server);
      server.send(JSON.stringify({ type: "connected" }));
      return new Response(null, { status: 101, webSocket: client });
    }

    const url = new URL(request.url);

    // Internal broadcast: the Worker posts an event here (e.g. match) → fan-out.
    if (request.method === "POST" && url.pathname.endsWith("/broadcast")) {
      const payload = await request.text();
      let sent = 0;
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send(payload);
          sent++;
        } catch {
          // client disconnected — ignore
        }
      }
      return Response.json({ ok: true, sent });
    }

    return new Response("not found", { status: 404 });
  }

  // --- Hibernation handlers ---
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    // Keep-alive: the client may send a ping.
    if (typeof message === "string" && message.includes("ping")) {
      ws.send(JSON.stringify({ type: "pong" }));
    }
  }

  webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): void {
    try {
      ws.close(code);
    } catch {
      // already closed
    }
  }

  webSocketError(): void {
    // nothing to do — the runtime cleans up the connection
  }
}
