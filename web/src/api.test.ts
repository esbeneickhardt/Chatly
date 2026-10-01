import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("sends the CSRF header and JSON body on a mutation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.post("/api/things", { name: "x" });

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/things");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Requested-With"]).toBe("XMLHttpRequest");
    expect(init.body).toBe(JSON.stringify({ name: "x" }));
    expect(init.credentials).toBe("same-origin");
  });

  it("supports PUT for idempotent toggles", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(204));
    vi.stubGlobal("fetch", fetchMock);
    await api.put("/api/guilds/1/admins/2");
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe("PUT");
  });

  it("resolves undefined for 204 No Content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(204)));
    await expect(api.del("/api/x")).resolves.toBeUndefined();
  });

  it("turns the server's error shape into an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(respond(403, { error: { code: "forbidden", message: "nope" } })),
    );
    const error = await api.get("/api/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: "forbidden", message: "nope" });
  });
});
