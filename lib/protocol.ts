export type Role = "sender" | "receiver";

export type FileMeta = {
  name: string;
  size: number;
  type: string;
  chunkSize: number;
  totalChunks: number;
};

export type SignalEnvelope = {
  kind: "join" | "offer" | "answer" | "ice" | "ready";
  from: string;
  to?: string;
  payload?: unknown;
};

export type DataControl =
  | {
      kind: "meta";
      payload: FileMeta;
    }
  | {
      kind: "done";
    };
