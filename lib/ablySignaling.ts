import * as Ably from "ably";
import type { SignalEnvelope } from "./protocol";

const EVENT_NAME = "signal";

export type AblyConnectionState =
  | "initialized"
  | "connecting"
  | "connected"
  | "disconnected"
  | "suspended"
  | "closing"
  | "closed"
  | "failed";

export class AblySignaling {
  private client: Ably.Realtime;
  private channel: Ably.RealtimeChannel;

  constructor(roomId: string, clientId: string) {
    this.client = new Ably.Realtime({
      authUrl: `/api/ably-token?roomId=${encodeURIComponent(roomId)}&clientId=${encodeURIComponent(clientId)}`,
      autoConnect: true,
      closeOnUnload: true
    });
    this.channel = this.client.channels.get(`room:${roomId}`);
  }

  async publish(message: SignalEnvelope): Promise<void> {
    await this.channel.publish(EVENT_NAME, message);
  }

  subscribe(handler: (message: SignalEnvelope) => void): () => void {
    const wrapped = (msg: Ably.Message) => {
      if (!msg.data || typeof msg.data !== "object") return;
      handler(msg.data as SignalEnvelope);
    };

    this.channel.subscribe(EVENT_NAME, wrapped);

    return () => {
      this.channel.unsubscribe(EVENT_NAME, wrapped);
    };
  }

  onConnectionStateChange(
    handler: (state: AblyConnectionState, reason?: string) => void
  ): () => void {
    const listener = (stateChange: Ably.ConnectionStateChange) => {
      const reason = stateChange.reason?.message;
      handler(stateChange.current as AblyConnectionState, reason);
    };

    this.client.connection.on(listener);

    return () => {
      this.client.connection.off(listener);
    };
  }

  getConnectionState(): AblyConnectionState {
    return this.client.connection.state as AblyConnectionState;
  }

  close(): void {
    this.client.close();
  }
}
