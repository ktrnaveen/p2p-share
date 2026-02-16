import * as Ably from "ably";
import type { SignalEnvelope } from "./protocol";

const EVENT_NAME = "signal";

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

  close(): void {
    this.client.close();
  }
}
