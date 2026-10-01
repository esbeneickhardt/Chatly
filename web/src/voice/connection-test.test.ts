import { describe, expect, it } from "vitest";
import { type ConnectionReport, explain } from "./connection-test";

const good: ConnectionReport = {
  secureContext: true,
  micError: null,
  relayServers: 1,
  reachedStun: true,
  relayOverUdp: true,
  relayOverTcp: true,
};

describe("explain", () => {
  it("says all is well when everything works", () => {
    const { findings, verdict } = explain(good);
    expect(findings.every((f) => f.ok)).toBe(true);
    expect(verdict).toContain("can reach the voice server");
  });

  it("puts the microphone first when it is blocked", () => {
    const { findings, verdict } = explain({ ...good, micError: "NotAllowedError" });
    expect(findings.find((f) => !f.ok)?.text).toContain("NotAllowedError");
    expect(verdict).toContain("microphone");
  });

  it("says the network is blocking voice when nothing reaches the server", () => {
    const { verdict } = explain({ ...good, reachedStun: false, relayOverUdp: false, relayOverTcp: false });
    expect(verdict).toContain("blocking voice");
    expect(verdict).toContain("Wi-Fi and mobile data");
  });

  it("knows UDP blocked but TCP working is still usable", () => {
    const { verdict } = explain({ ...good, reachedStun: false, relayOverUdp: false });
    expect(verdict).toContain("TCP works");
  });

  it("flags a page that is not secure", () => {
    const { findings } = explain({ ...good, secureContext: false });
    expect(findings[0].ok).toBe(false);
  });

  it("blames the server, not the network, when there is no relay to test against", () => {
    const { verdict } = explain({
      ...good,
      relayServers: 0,
      reachedStun: false,
      relayOverUdp: false,
      relayOverTcp: false,
    });
    expect(verdict).toContain("no voice relay");
    expect(verdict).not.toContain("blocking");
  });
});
