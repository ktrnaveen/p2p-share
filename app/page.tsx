"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AblySignaling } from "@/lib/ablySignaling";
import type { DataControl, FileMeta, Role } from "@/lib/protocol";
import { createPeerConnection } from "@/lib/webrtc";

const CHUNK_SIZE = 256 * 1024;

type ConnState = "idle" | "connecting" | "connected" | "failed";
type ReceiveStorageMode = "memory" | "disk";

function randomId(length = 8): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i += 1) id += chars[bytes[i] % chars.length];
  return id;
}

function makePeerId(): string {
  return `${Date.now()}-${randomId(6)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function Progress({ label, value }: { label: string; value: number }) {
  const bounded = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className="progress-wrap">
      <div className="progress-head">
        <span>{label}</span>
        <span>{bounded.toFixed(1)}%</span>
      </div>
      <div className="bar">
        <div className="fill" style={{ width: `${bounded}%` }} />
      </div>
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through
    }
  }

  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "absolute";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

function waitForBufferedAmountLow(channel: RTCDataChannel, threshold: number): Promise<void> {
  if (channel.readyState !== "open" || channel.bufferedAmount <= threshold) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      channel.removeEventListener("bufferedamountlow", onLow);
      channel.removeEventListener("close", onClose);
      channel.removeEventListener("error", onError);
      clearTimeout(timer);
    };

    const onLow = () => {
      finish();
      resolve();
    };

    const onClose = () => {
      finish();
      reject(new Error("Channel closed while waiting for buffer drain"));
    };

    const onError = () => {
      finish();
      reject(new Error("Channel errored while waiting for buffer drain"));
    };

    const timer = window.setTimeout(() => {
      if (channel.readyState !== "open") {
        onClose();
        return;
      }
      if (channel.bufferedAmount <= threshold) {
        onLow();
      } else {
        finish();
        reject(new Error("Buffer drain timeout"));
      }
    }, 6000);

    channel.addEventListener("bufferedamountlow", onLow, { once: true });
    channel.addEventListener("close", onClose, { once: true });
    channel.addEventListener("error", onError, { once: true });
  });
}

export default function HomePage() {
  const [role, setRole] = useState<Role>("sender");
  const [roomId, setRoomId] = useState("");
  const [status, setStatus] = useState("Ready");
  const [connState, setConnState] = useState<ConnState>("idle");
  const [shareLink, setShareLink] = useState("");
  const [peerId, setPeerId] = useState("");
  const [targetPeer, setTargetPeer] = useState<string | null>(null);
  const [sendProgress, setSendProgress] = useState(0);
  const [receiveProgress, setReceiveProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState("download.bin");
  const [incomingMeta, setIncomingMeta] = useState<FileMeta | null>(null);
  const [preferDiskReceive, setPreferDiskReceive] = useState(true);
  const [saveHandleReady, setSaveHandleReady] = useState(false);
  const [activeReceiveMode, setActiveReceiveMode] = useState<ReceiveStorageMode>("memory");
  const [savedToDiskName, setSavedToDiskName] = useState<string | null>(null);

  const signalingRef = useRef<AblySignaling | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const incomingChunksRef = useRef<BlobPart[]>([]);
  const incomingMetaRef = useRef<FileMeta | null>(null);
  const incomingReceivedRef = useRef(0);
  const downloadUrlRef = useRef<string | null>(null);
  const saveHandleRef = useRef<unknown>(null);
  const writableRef = useRef<unknown>(null);

  const fileSystemAccessSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    return typeof (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";
  }, []);

  const roomFromUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("room") ?? "";
  }, []);

  useEffect(() => {
    setPeerId(makePeerId());
  }, []);

  useEffect(() => {
    if (roomFromUrl) {
      setRole("receiver");
      setRoomId(roomFromUrl);
    }
  }, [roomFromUrl]);

  useEffect(() => {
    incomingMetaRef.current = incomingMeta;
  }, [incomingMeta]);

  useEffect(() => {
    downloadUrlRef.current = downloadUrl;
  }, [downloadUrl]);

  useEffect(() => {
    if (!fileSystemAccessSupported) {
      setPreferDiskReceive(false);
    }
  }, [fileSystemAccessSupported]);

  useEffect(() => {
    if (!preferDiskReceive) {
      void closeWritable(true);
      setActiveReceiveMode("memory");
    }
  }, [preferDiskReceive]);

  useEffect(() => {
    return () => {
      cleanup(false);
      if (downloadUrlRef.current) {
        URL.revokeObjectURL(downloadUrlRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setStatusSafe(nextStatus: string) {
    setStatus(nextStatus);
  }

  async function closeWritable(abort = false) {
    const writable = writableRef.current as
      | { close?: () => Promise<void>; abort?: (reason?: unknown) => Promise<void> }
      | null;
    if (!writable) return;

    writableRef.current = null;
    try {
      if (abort && typeof writable.abort === "function") {
        await writable.abort();
      } else if (typeof writable.close === "function") {
        await writable.close();
      }
    } catch {
      // Ignore cleanup failures.
    }
  }

  function cleanup(resetUi = true) {
    void closeWritable(true);

    unsubRef.current?.();
    unsubRef.current = null;

    signalingRef.current?.close();
    signalingRef.current = null;

    channelRef.current?.close();
    channelRef.current = null;

    peerRef.current?.close();
    peerRef.current = null;

    pendingIceRef.current = [];

    if (resetUi) {
      setTargetPeer(null);
      setConnState("idle");
      setSendProgress(0);
      setReceiveProgress(0);
      setIncomingMeta(null);
      incomingMetaRef.current = null;
      incomingChunksRef.current = [];
      incomingReceivedRef.current = 0;
      setActiveReceiveMode("memory");
      setSavedToDiskName(null);
    }
  }

  function setRoomLink(rid: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("room", rid);
    setShareLink(url.toString());
  }

  function resetIncomingTransfer() {
    void closeWritable(true);
    setSavedToDiskName(null);
    setActiveReceiveMode("memory");
    incomingChunksRef.current = [];
    incomingReceivedRef.current = 0;
    setReceiveProgress(0);
    setIncomingMeta(null);
    incomingMetaRef.current = null;
    setDownloadUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  async function prepareSaveLocation() {
    if (!fileSystemAccessSupported) {
      setStatusSafe("Direct-to-disk is not supported on this browser");
      return;
    }

    const picker = (window as Window & { showSaveFilePicker?: (opts?: unknown) => Promise<unknown> })
      .showSaveFilePicker;

    if (typeof picker !== "function") {
      setStatusSafe("Save picker unavailable");
      return;
    }

    try {
      const handle = await picker({
        suggestedName: "incoming-file.bin"
      });
      saveHandleRef.current = handle;
      setSaveHandleReady(true);
      setStatusSafe("Save location is ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatusSafe("Save location selection canceled");
        return;
      }
      setStatusSafe("Failed to prepare save location");
    }
  }

  async function flushPendingIce() {
    if (!peerRef.current || pendingIceRef.current.length === 0) return;

    const pending = [...pendingIceRef.current];
    pendingIceRef.current = [];

    for (const candidate of pending) {
      try {
        await peerRef.current.addIceCandidate(candidate);
      } catch {
        // Keep the connection attempt alive if one candidate is stale.
      }
    }
  }

  async function connectSignaling(rid: string) {
    if (!peerId) {
      throw new Error("Peer is still initializing");
    }

    const signaling = new AblySignaling(rid, peerId);
    signalingRef.current = signaling;

    unsubRef.current = signaling.subscribe(async (msg) => {
      if (msg.from === peerId) return;
      if (msg.to && msg.to !== peerId) return;

      try {
        switch (msg.kind) {
          case "join": {
            if (role !== "sender") return;
            if (targetPeer && targetPeer !== msg.from && connState === "connected") {
              setStatusSafe("A receiver is already connected");
              return;
            }
            setTargetPeer(msg.from);
            await createOffer(msg.from);
            break;
          }
          case "offer": {
            if (role !== "receiver") return;
            setTargetPeer(msg.from);
            await onOffer(msg.from, msg.payload as RTCSessionDescriptionInit);
            break;
          }
          case "answer": {
            if (role !== "sender") return;
            await onAnswer(msg.payload as RTCSessionDescriptionInit);
            break;
          }
          case "ice": {
            await onIce(msg.payload as RTCIceCandidateInit);
            break;
          }
          case "ready": {
            setStatusSafe("Peer is ready");
            break;
          }
          default:
            break;
        }
      } catch {
        setConnState("failed");
        setStatusSafe("Signaling handling failed");
      }
    });
  }

  function makePeerConnection(remotePeer: string) {
    peerRef.current?.close();

    const peer = createPeerConnection();
    peerRef.current = peer;

    peer.onicecandidate = async (event) => {
      if (!event.candidate) return;
      await signalingRef.current?.publish({
        kind: "ice",
        from: peerId,
        to: remotePeer,
        payload: event.candidate.toJSON()
      });
    };

    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      if (state === "connected") {
        setConnState("connected");
        setStatusSafe("Connected");
      } else if (state === "failed") {
        setConnState("failed");
        setStatusSafe("Connection failed");
      } else if (state === "disconnected") {
        setConnState("failed");
        setStatusSafe("Connection disconnected");
      } else if (state === "connecting") {
        setConnState("connecting");
        setStatusSafe("Connecting...");
      }
    };

    if (role === "receiver") {
      peer.ondatachannel = (ev) => {
        bindDataChannel(ev.channel);
      };
    }

    return peer;
  }

  function bindDataChannel(ch: RTCDataChannel) {
    channelRef.current = ch;
    ch.binaryType = "arraybuffer";
    ch.bufferedAmountLowThreshold = CHUNK_SIZE * 4;

    ch.onopen = () => {
      setStatusSafe("Data channel open");
      setConnState("connected");
      if (role === "receiver") {
        void signalingRef.current?.publish({ kind: "ready", from: peerId, to: targetPeer ?? undefined });
      }
    };

    ch.onclose = () => {
      setStatusSafe("Data channel closed");
      if (connState !== "failed") setConnState("idle");
    };

    ch.onerror = () => {
      setStatusSafe("Data channel error");
      setConnState("failed");
    };

    ch.onmessage = async (ev) => {
      if (typeof ev.data === "string") {
        let control: DataControl;
        try {
          control = JSON.parse(ev.data) as DataControl;
        } catch {
          setStatusSafe("Received malformed control message");
          return;
        }

        if (control.kind === "meta") {
          resetIncomingTransfer();
          setIncomingMeta(control.payload);
          incomingMetaRef.current = control.payload;
          setDownloadName(control.payload.name);
          if (role === "receiver" && preferDiskReceive && saveHandleRef.current) {
            try {
              const writable = await (
                saveHandleRef.current as { createWritable: () => Promise<unknown> }
              ).createWritable();
              writableRef.current = writable;
              setActiveReceiveMode("disk");
              setStatusSafe(`Receiving ${control.payload.name} directly to disk`);
            } catch {
              setActiveReceiveMode("memory");
              setStatusSafe(`Receiving ${control.payload.name} (memory mode fallback)`);
            }
          } else {
            setActiveReceiveMode("memory");
            setStatusSafe(`Receiving ${control.payload.name}`);
          }
          return;
        }

        if (control.kind === "done") {
          if (writableRef.current) {
            await closeWritable(false);
            setSavedToDiskName(incomingMetaRef.current?.name || "received file");
            setReceiveProgress(100);
            setStatusSafe("Transfer complete. File saved to selected location.");
            return;
          }

          const mimeType = incomingMetaRef.current?.type || "application/octet-stream";
          const blob = new Blob(incomingChunksRef.current, { type: mimeType });
          const url = URL.createObjectURL(blob);
          setDownloadUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
          setReceiveProgress(100);
          setStatusSafe("Transfer complete");
        }
        return;
      }

      let chunk: ArrayBuffer;
      if (ev.data instanceof ArrayBuffer) {
        chunk = ev.data;
      } else if (ev.data instanceof Blob) {
        chunk = await ev.data.arrayBuffer();
      } else {
        return;
      }

      if (writableRef.current) {
        try {
          await (
            writableRef.current as { write: (data: ArrayBuffer) => Promise<void> }
          ).write(chunk);
        } catch {
          setConnState("failed");
          setStatusSafe("Disk write failed during transfer");
          await closeWritable(true);
          return;
        }
      } else {
        incomingChunksRef.current.push(chunk);
      }
      incomingReceivedRef.current += chunk.byteLength;

      const total = incomingMetaRef.current?.size ?? 1;
      const pct = total > 0 ? (incomingReceivedRef.current / total) * 100 : 100;
      setReceiveProgress(pct);
    };
  }

  async function createOffer(remotePeer: string) {
    const peer = makePeerConnection(remotePeer);
    const channel = peer.createDataChannel("file", {
      ordered: true
    });
    bindDataChannel(channel);

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    await signalingRef.current?.publish({
      kind: "offer",
      from: peerId,
      to: remotePeer,
      payload: offer
    });
  }

  async function onOffer(remotePeer: string, offer: RTCSessionDescriptionInit) {
    const peer = makePeerConnection(remotePeer);
    await peer.setRemoteDescription(offer);
    await flushPendingIce();

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    await signalingRef.current?.publish({
      kind: "answer",
      from: peerId,
      to: remotePeer,
      payload: answer
    });
  }

  async function onAnswer(answer: RTCSessionDescriptionInit) {
    if (!peerRef.current) return;
    await peerRef.current.setRemoteDescription(answer);
    await flushPendingIce();
  }

  async function onIce(candidate: RTCIceCandidateInit) {
    if (!peerRef.current || !peerRef.current.remoteDescription) {
      pendingIceRef.current.push(candidate);
      return;
    }

    try {
      await peerRef.current.addIceCandidate(candidate);
    } catch {
      // Ignore late candidates during reconnect churn.
    }
  }

  async function startAsSender() {
    if (!peerId) {
      setStatusSafe("Initializing peer identity...");
      return;
    }

    try {
      cleanup();
      const rid = randomId(10);
      setRoomId(rid);
      setRoomLink(rid);
      setStatusSafe("Waiting for receiver...");
      await connectSignaling(rid);
    } catch {
      setConnState("failed");
      setStatusSafe("Failed to create room");
    }
  }

  async function joinAsReceiver() {
    if (!peerId) {
      setStatusSafe("Initializing peer identity...");
      return;
    }

    const rid = roomId.trim();
    if (!rid) {
      setStatusSafe("Room ID is required");
      return;
    }

    try {
      cleanup();
      setStatusSafe("Joining room...");
      await connectSignaling(rid);
      await signalingRef.current?.publish({
        kind: "join",
        from: peerId
      });
    } catch {
      setConnState("failed");
      setStatusSafe("Failed to join room");
    }
  }

  async function sendFile() {
    const file = selectedFile;
    const channel = channelRef.current;

    if (!file || !channel || channel.readyState !== "open") {
      setStatusSafe("Select a file and wait for connection");
      return;
    }

    if (file.size === 0) {
      setStatusSafe("Empty files are not supported");
      return;
    }

    const meta: FileMeta = {
      name: file.name,
      type: file.type,
      size: file.size,
      chunkSize: CHUNK_SIZE,
      totalChunks: Math.ceil(file.size / CHUNK_SIZE)
    };

    setSendProgress(0);
    channel.send(JSON.stringify({ kind: "meta", payload: meta } satisfies DataControl));

    let sent = 0;
    try {
      for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
        if (channel.readyState !== "open") {
          throw new Error("Channel closed during transfer");
        }

        await waitForBufferedAmountLow(channel, CHUNK_SIZE * 8);

        const slice = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
        const buffer = await slice.arrayBuffer();
        channel.send(buffer);
        sent += buffer.byteLength;
        setSendProgress((sent / file.size) * 100);
      }

      channel.send(JSON.stringify({ kind: "done" } satisfies DataControl));
      setSendProgress(100);
      setStatusSafe("File sent");
    } catch {
      setConnState("failed");
      setStatusSafe("Transfer interrupted");
    }
  }

  const canSendFile = connState === "connected" && Boolean(selectedFile);

  return (
    <main className="container">
      <div className="orb orb-one" aria-hidden />
      <div className="orb orb-two" aria-hidden />

      <section className="card">
        <header className="hero">
          <p className="badge">WebRTC Direct Transfer</p>
          <h1>P2P Share</h1>
          <p className="sub">Fast one-to-one file transfer with no server-side file storage.</p>
        </header>

        <div className="tabs" role="tablist" aria-label="Transfer role">
          <button
            type="button"
            className={role === "sender" ? "active" : ""}
            onClick={() => setRole("sender")}
          >
            Sender
          </button>
          <button
            type="button"
            className={role === "receiver" ? "active" : ""}
            onClick={() => setRole("receiver")}
          >
            Receiver
          </button>
        </div>

        {role === "sender" ? (
          <div className="stack">
            <button type="button" className="primary" onClick={startAsSender}>
              Create Share Link
            </button>

            <label className="file-picker" htmlFor="file-input">
              <input
                id="file-input"
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setSelectedFile(file);
                  if (file) {
                    setStatusSafe(`Selected ${file.name}`);
                    setSendProgress(0);
                  }
                }}
              />
              <span>{selectedFile ? `${selectedFile.name} (${formatBytes(selectedFile.size)})` : "Select file"}</span>
            </label>

            <button type="button" onClick={sendFile} disabled={!canSendFile}>
              Send File
            </button>

            {shareLink && (
              <div className="share">
                <p>Share this link:</p>
                <code>{shareLink}</code>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await copyText(shareLink);
                    setStatusSafe(ok ? "Link copied" : "Copy failed. Copy manually.");
                  }}
                >
                  Copy Link
                </button>
              </div>
            )}

            <Progress label="Upload" value={sendProgress} />
          </div>
        ) : (
          <div className="stack">
            {fileSystemAccessSupported ? (
              <div className="receiver-storage">
                <label className="checkbox-row" htmlFor="disk-mode">
                  <input
                    id="disk-mode"
                    type="checkbox"
                    checked={preferDiskReceive}
                    onChange={(e) => setPreferDiskReceive(e.target.checked)}
                  />
                  Use direct-to-disk receive mode for large files
                </label>
                <button type="button" onClick={prepareSaveLocation} disabled={!preferDiskReceive}>
                  {saveHandleReady ? "Save location ready" : "Prepare Save Location"}
                </button>
              </div>
            ) : (
              <p className="meta">This browser does not support direct-to-disk receive mode.</p>
            )}

            <label htmlFor="room-input">
              Room ID or use shared link
              <input
                id="room-input"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Enter room ID"
              />
            </label>
            <button type="button" className="primary" onClick={joinAsReceiver}>
              Join Room
            </button>

            <Progress label="Download" value={receiveProgress} />

            {incomingMeta && (
              <p className="meta">
                Receiving: <strong>{incomingMeta.name}</strong> ({formatBytes(incomingMeta.size)})
              </p>
            )}

            {downloadUrl && (
              <a className="download" href={downloadUrl} download={downloadName}>
                Download Received File
              </a>
            )}
            {savedToDiskName && <p className="meta">Saved directly to disk: {savedToDiskName}</p>}
          </div>
        )}

        <div className="status">
          <p>
            <span>Status</span>
            <strong>{status}</strong>
          </p>
          <p>
            <span>Connection</span>
            <strong>{connState}</strong>
          </p>
          <p>
            <span>Your peer ID</span>
            <strong>{peerId || "initializing..."}</strong>
          </p>
          <p>
            <span>Room</span>
            <strong>{roomId || "-"}</strong>
          </p>
          <p>
            <span>Connected peer</span>
            <strong>{targetPeer || "-"}</strong>
          </p>
          <p>
            <span>Receive mode</span>
            <strong>{activeReceiveMode}</strong>
          </p>
        </div>
      </section>
    </main>
  );
}
