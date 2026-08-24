// Durable Object — stare live per cameră (WebSocket + broadcast match).
//
// HARD REQUIREMENTS:
//  - SQLite storage backend (migrations `new_sqlite_classes` în wrangler.toml).
//  - WebSocket Hibernation API: folosim `state.acceptWebSocket()` +
//    handlerele `webSocketMessage/Close/Error`, deci DO-ul nu consumă compute
//    cât camera e idle (conexiunile „hibernează").
//
// Arhitectură (D1 = sursa de adevăr, DO = live):
//  - swipe-urile și match-urile se persistă în D1 de către Worker.
//  - DO-ul ține DOAR conexiunile WebSocket și face fan-out („broadcast") când
//    Worker-ul îi trimite un eveniment de match → clienții primesc live, fără refresh.

import type { Env } from "../types";

export class Room {
  private state: DurableObjectState;

  // env e primit dar nefolosit aici: D1 = sursa de adevăr (scrierile sunt în Worker),
  // DO-ul doar face fan-out WebSocket.
  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    // Upgrade WebSocket (clientul se conectează la /api/rooms/:id/ws).
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      // Hibernation: runtime-ul gestionează conexiunea; nu ținem noi referințe.
      this.state.acceptWebSocket(server);
      server.send(JSON.stringify({ type: "connected" }));
      return new Response(null, { status: 101, webSocket: client });
    }

    const url = new URL(request.url);

    // Broadcast intern: Worker-ul trimite aici un eveniment (ex. match) → fan-out.
    if (request.method === "POST" && url.pathname.endsWith("/broadcast")) {
      const payload = await request.text();
      let sent = 0;
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send(payload);
          sent++;
        } catch {
          // client deconectat — ignorăm
        }
      }
      return Response.json({ ok: true, sent });
    }

    return new Response("not found", { status: 404 });
  }

  // --- Handlere Hibernation ---
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    // Keep-alive: clientul poate trimite un ping.
    if (typeof message === "string" && message.includes("ping")) {
      ws.send(JSON.stringify({ type: "pong" }));
    }
  }

  webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): void {
    try {
      ws.close(code);
    } catch {
      // deja închis
    }
  }

  webSocketError(): void {
    // nimic de făcut — runtime-ul curăță conexiunea
  }
}
