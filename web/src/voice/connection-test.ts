// "Can this device make a call?" — checks each thing a call needs and says,
// in words, which one is missing. A call that will not connect gives the
// person nothing to go on; this does.

import { getIceServers } from "./util";

/** What one check found. */
export interface ConnectionReport {
  secureContext: boolean;
  /** null if the microphone opened, else why it did not. */
  micError: string | null;
  /** How many voice-relay servers the app was told about. */
  relayServers: number;
  /** Address types this device could find with the relay's help. */
  reachedStun: boolean;
  relayOverUdp: boolean;
  relayOverTcp: boolean;
}

export interface Finding {
  ok: boolean;
  text: string;
}

/** What a report means, worst problem first when there are several. Pure, so
 * the wording can be checked without a network. */
export function explain(report: ConnectionReport): { findings: Finding[]; verdict: string } {
  const findings: Finding[] = [
    {
      ok: report.secureContext,
      text: report.secureContext
        ? "This page is secure (HTTPS)"
        : "This page is not secure, so the browser will not allow the microphone",
    },
    {
      ok: report.micError === null,
      text:
        report.micError === null
          ? "Microphone works"
          : `Microphone blocked (${report.micError}). Allow it for this site in the browser's settings`,
    },
    {
      ok: report.relayServers > 0,
      text:
        report.relayServers > 0
          ? "The voice relay is configured"
          : "The server did not offer a voice relay, so calls only work on networks that allow direct connections",
    },
    {
      ok: report.reachedStun,
      text: report.reachedStun
        ? "Reached the voice server's address service (UDP)"
        : "Could not reach the voice server's address service (UDP)",
    },
    {
      ok: report.relayOverUdp,
      text: report.relayOverUdp ? "Voice relay works over UDP" : "Voice relay does not work over UDP",
    },
    {
      ok: report.relayOverTcp,
      text: report.relayOverTcp ? "Voice relay works over TCP" : "Voice relay does not work over TCP",
    },
  ];

  let verdict: string;
  if (!report.secureContext || report.micError !== null) {
    verdict = "Fix the microphone first: nothing else matters until it works.";
  } else if (report.relayServers === 0) {
    verdict =
      "This server has no voice relay set up, so calls only connect between networks that can reach it directly. That is a server setting, not something on this device.";
  } else if (report.relayOverUdp || report.relayOverTcp || report.reachedStun) {
    verdict =
      report.relayOverUdp || report.reachedStun
        ? "This device can reach the voice server. If a call still fails, the other person's network is the likely cause."
        : "UDP is blocked here but TCP works, so calls should connect through the relay (a little slower).";
  } else {
    verdict =
      "This network is blocking voice traffic to the server. Try switching between Wi-Fi and mobile data, or turn off a VPN or private DNS, and test again.";
  }
  return { findings, verdict };
}

const GATHER_TIMEOUT_MS = 6000;

/** Candidate types a connection attempt turns up with these servers. */
async function gather(iceServers: RTCIceServer[], relayOnly: boolean): Promise<Set<string>> {
  const types = new Set<string>();
  const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: relayOnly ? "relay" : "all" });
  try {
    pc.createDataChannel("probe");
    const done = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, GATHER_TIMEOUT_MS);
      pc.addEventListener("icecandidate", (event) => {
        if (event.candidate) {
          const type = / typ (\w+)/.exec(event.candidate.candidate)?.[1];
          if (type) types.add(type);
        } else {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await pc.setLocalDescription(await pc.createOffer());
    await done;
  } catch {
    /* whatever was found before the error still counts */
  } finally {
    pc.close();
  }
  return types;
}

export async function testConnection(): Promise<ConnectionReport> {
  let micError: string | null = null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (err) {
    micError = err instanceof DOMException ? err.name : "unavailable";
  }

  const servers = await getIceServers();
  const stun = servers.filter((s) => !s.username);
  const turn = servers.filter((s) => s.username);
  const only = (transport: "udp" | "tcp"): RTCIceServer[] =>
    turn.map((s) => ({
      ...s,
      urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => u.includes(`transport=${transport}`)),
    }));

  const [direct, udp, tcp] = await Promise.all([
    gather([...stun, ...turn], false),
    gather(only("udp"), true),
    gather(only("tcp"), true),
  ]);
  return {
    secureContext: window.isSecureContext,
    micError,
    relayServers: turn.length,
    reachedStun: direct.has("srflx") || direct.has("relay"),
    relayOverUdp: udp.has("relay"),
    relayOverTcp: tcp.has("relay"),
  };
}
