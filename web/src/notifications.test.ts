import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notificationsEnabled, notify, setNotificationsEnabled } from "./notifications";

type FakeNotification = {
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
};

function stubNotification(permission: NotificationPermission, asked: NotificationPermission = permission) {
  const requestPermission = vi.fn().mockResolvedValue(asked);
  const ctor = vi.fn() as unknown as FakeNotification & { new (): object };
  ctor.permission = permission;
  ctor.requestPermission = requestPermission;
  vi.stubGlobal("Notification", ctor);
  return { ctor, requestPermission };
}

function hidden(value: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  hidden(false);
});

describe("turning notifications on", () => {
  it("asks the browser once and remembers the answer", async () => {
    const { requestPermission } = stubNotification("default", "granted");
    expect(await setNotificationsEnabled(true)).toBe("on");
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(localStorage.getItem("chatty:desktopNotifications")).toBe("1");
  });

  it("reports a refusal instead of pretending it worked", async () => {
    stubNotification("default", "denied");
    expect(await setNotificationsEnabled(true)).toBe("denied");
    expect(notificationsEnabled()).toBe(false);
  });

  it("doesn't re-prompt when permission was already granted", async () => {
    const { requestPermission } = stubNotification("granted");
    expect(await setNotificationsEnabled(true)).toBe("on");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("can be turned off again", async () => {
    stubNotification("granted");
    await setNotificationsEnabled(true);
    expect(notificationsEnabled()).toBe(true);
    expect(await setNotificationsEnabled(false)).toBe("off");
    expect(notificationsEnabled()).toBe(false);
  });

  it("reports an unsupported browser", async () => {
    vi.stubGlobal("Notification", undefined);
    expect(await setNotificationsEnabled(true)).toBe("unsupported");
  });
});

describe("showing a notification", () => {
  const request = { title: "Ana", body: "hi", tag: "c1", data: { channelId: "c1" } };

  it("does nothing while you're looking at the app", async () => {
    const { ctor } = stubNotification("granted");
    await setNotificationsEnabled(true);
    hidden(false);
    await notify(request);
    expect(ctor).not.toHaveBeenCalled();
  });

  it("does nothing when they're switched off, even if the page is hidden", async () => {
    const { ctor } = stubNotification("granted");
    hidden(true);
    await notify(request);
    expect(ctor).not.toHaveBeenCalled();
  });

  it("shows one when enabled and the page is in the background", async () => {
    const { ctor } = stubNotification("granted");
    await setNotificationsEnabled(true);
    hidden(true);
    await notify(request);
    expect(ctor).toHaveBeenCalledWith("Ana", expect.objectContaining({ body: "hi", tag: "c1" }));
  });
});
