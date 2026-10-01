import { describe, expect, it } from "vitest";
import { friendlyFileLabel, looksMachineGenerated } from "./file-labels";

describe("looksMachineGenerated", () => {
  it.each([
    "17895058467123352784638444487746.jpg", // phone camera counter
    "{453C540C-C0CE-4F19-8A32-A371BDD48080}.png", // Windows snipping tool GUID
    "453c540c-c0ce-4f19-8a32-a371bdd48080.mp4",
    "dQw4w9WgXcQ7aBcDeFgHiJkLmN.webp", // random mixed-case token with digits
  ])("flags %s", (name) => {
    expect(looksMachineGenerated(name)).toBe(true);
  });

  it.each(["holiday photo.jpg", "MyHolidayPhoto.png", "report-final-v2.pdf", "notes.txt", ""])(
    "leaves %j alone",
    (name) => {
      expect(looksMachineGenerated(name)).toBe(false);
    },
  );
});

describe("friendlyFileLabel", () => {
  it("keeps a human filename exactly", () => {
    expect(friendlyFileLabel("budget 2026.xlsx", "application/vnd.ms-excel")).toBe("budget 2026.xlsx");
  });

  it("describes a machine-named file by its kind instead", () => {
    expect(friendlyFileLabel("17895058467123352784638444487746.jpg", "image/jpeg")).toBe("Image");
    expect(friendlyFileLabel("453c540c-c0ce-4f19-8a32-a371bdd48080.mp4", "video/mp4")).toBe("Video");
  });
});
