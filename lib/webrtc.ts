/**
 * WebRTC configuration tuned for aggressive NAT traversal.
 *
 * Key strategy: use many diverse STUN servers so the ICE agent discovers
 * as many reflexive (srflx) candidates as possible.  On a symmetric NAT
 * each STUN server may return a *different* mapped port, giving the peer
 * more port/address pairs to probe — which substantially increases the
 * chance of a successful direct connection even across carrier-grade NATs.
 */

// ---------------------------------------------------------------------------
// ICE server list — free, public STUN servers from diverse providers
// ---------------------------------------------------------------------------
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  // Google (multiple IPs / anycast)
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun2.l.google.com:19302",
      "stun:stun3.l.google.com:19302",
      "stun:stun4.l.google.com:19302",
    ],
  },
  // Cloudflare
  { urls: "stun:stun.cloudflare.com:3478" },
  // Mozilla
  { urls: "stun:stun.services.mozilla.com:3478" },
  // Twilio (global anycast)
  { urls: "stun:global.stun.twilio.com:3478" },
  // Open Relay Project
  { urls: "stun:openrelay.metered.ca:80" },
  // Stunprotocol.org
  { urls: "stun:stun.stunprotocol.org:3478" },
  // NextCloud
  { urls: "stun:stun.nextcloud.com:443" },
  // Sipgate
  { urls: "stun:stun.sipgate.net:3478" },
  // 1und1
  { urls: "stun:stun.1und1.de:3478" },
];

// ---------------------------------------------------------------------------
// Peer connection factory
// ---------------------------------------------------------------------------
export function buildIceServers(): RTCIceServer[] {
  const servers = [...DEFAULT_ICE_SERVERS];

  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  const turnUser = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const turnPass = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

  if (turnUrl && turnUser && turnPass) {
    servers.push({
      urls: turnUrl,
      username: turnUser,
      credential: turnPass,
    });
  }

  return servers;
}

export function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: buildIceServers(),
    iceCandidatePoolSize: 25,       // pre-allocate more candidates
    bundlePolicy: "max-bundle",     // fewer ICE components → faster
    rtcpMuxPolicy: "require",       // always mux RTP+RTCP
  });
}

// ---------------------------------------------------------------------------
// Candidate analysis helpers
// ---------------------------------------------------------------------------
export type CandidateInfo = {
  type: "host" | "srflx" | "relay" | "prflx" | "unknown";
  protocol: string;
  address: string;
  port: number;
  raw: string;
};

export function parseCandidateInfo(candidate: RTCIceCandidate): CandidateInfo {
  const c = candidate.candidate;
  const typ = candidate.type ?? (c.match(/typ (\S+)/)?.[1]) ?? "unknown";
  const protocol = candidate.protocol ?? (c.match(/udp|tcp/i)?.[0]?.toLowerCase()) ?? "unknown";
  const address = candidate.address ?? c.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? "unknown";
  const port = candidate.port ?? parseInt(c.match(/(\d+) typ/)?.[1] ?? "0", 10);

  return {
    type: typ as CandidateInfo["type"],
    protocol,
    address,
    port,
    raw: c,
  };
}

/**
 * Analyse the set of gathered local candidates to guess the NAT type.
 *
 * - "open"       – host candidates are directly reachable (no NAT)
 * - "cone"       – all srflx candidates share the same IP:port → easy traversal
 * - "restricted" – srflx candidates share the same IP but different ports → harder
 * - "symmetric"  – unique IP:port per STUN server → hardest, may require TURN
 * - "unknown"    – not enough data
 */
export type NatType = "open" | "cone" | "restricted" | "symmetric" | "unknown";

export function detectNatType(candidates: CandidateInfo[]): NatType {
  const srflx = candidates.filter((c) => c.type === "srflx");

  if (srflx.length === 0) {
    // Only host candidates? Could be open or STUN is blocked
    const host = candidates.filter((c) => c.type === "host");
    return host.length > 0 ? "open" : "unknown";
  }

  // Unique srflx address:port pairs
  const uniqueEndpoints = new Set(srflx.map((c) => `${c.address}:${c.port}`));
  const uniqueAddresses = new Set(srflx.map((c) => c.address));

  if (uniqueEndpoints.size === 1) return "cone";
  if (uniqueAddresses.size === 1) return "restricted";
  if (uniqueEndpoints.size >= 3) return "symmetric";

  // Few unique endpoints — restricted cone with some variance
  return "restricted";
}

// ---------------------------------------------------------------------------
// ICE gathering helper – waits for gathering to complete (or timeout)
// ---------------------------------------------------------------------------

/**
 * Wait until the peer connection's ICE gathering state reaches "complete",
 * or until `timeoutMs` elapses — whichever comes first.
 *
 * Returns all locally-gathered candidates collected during the wait.
 */
export function waitForIceGatheringComplete(
  pc: RTCPeerConnection,
  timeoutMs = 5000,
  onCandidate?: (candidate: RTCIceCandidate) => void
): Promise<RTCIceCandidate[]> {
  return new Promise((resolve) => {
    const gathered: RTCIceCandidate[] = [];

    if (pc.iceGatheringState === "complete") {
      resolve(gathered);
      return;
    }

    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener("icecandidate", onIce);
      pc.removeEventListener("icegatheringstatechange", onStateChange);
      resolve(gathered);
    };

    const onIce = (ev: RTCPeerConnectionIceEvent) => {
      if (ev.candidate) {
        gathered.push(ev.candidate);
        onCandidate?.(ev.candidate);
      } else {
        // null candidate means gathering complete
        finish();
      }
    };

    const onStateChange = () => {
      if (pc.iceGatheringState === "complete") {
        finish();
      }
    };

    pc.addEventListener("icecandidate", onIce);
    pc.addEventListener("icegatheringstatechange", onStateChange);

    const timer = setTimeout(finish, timeoutMs);
  });
}
