import { NextRequest, NextResponse } from "next/server";
import * as Ably from "ably";

export const runtime = "nodejs";

const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{3,64}$/;
const CLIENT_ID_PATTERN = /^[a-zA-Z0-9_-]{6,120}$/;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing ABLY_API_KEY on server" }, { status: 500 });
  }

  const roomId = request.nextUrl.searchParams.get("roomId");
  const clientId = request.nextUrl.searchParams.get("clientId");

  if (!roomId || !ROOM_ID_PATTERN.test(roomId)) {
    return NextResponse.json({ error: "Invalid roomId" }, { status: 400 });
  }

  if (!clientId || !CLIENT_ID_PATTERN.test(clientId)) {
    return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });
  }

  const channelName = `room:${roomId}`;
  const capability = {
    [channelName]: ["publish", "subscribe"]
  };

  const rest = new Ably.Rest(apiKey);
  const tokenRequest = await rest.auth.createTokenRequest({
    clientId,
    capability: JSON.stringify(capability),
    ttl: 60 * 60 * 1000
  });

  return NextResponse.json(tokenRequest, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
