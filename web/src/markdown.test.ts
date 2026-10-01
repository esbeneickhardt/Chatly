import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

function html(content: string, mentions?: Set<string>): string {
  const host = document.createElement("div");
  host.appendChild(renderMarkdown(content, mentions));
  return host.innerHTML;
}

describe("renderMarkdown is safe by construction", () => {
  it("never turns message text into markup", () => {
    const out = html('<img src=x onerror="alert(1)"> <script>alert(1)</script>');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
  });

  it("does not create a link from a javascript: URL", () => {
    const host = document.createElement("div");
    host.appendChild(renderMarkdown("[click](javascript:alert(1)) javascript:alert(1)"));
    for (const a of host.querySelectorAll("a")) {
      expect(a.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
    }
  });

  it("opens real links safely", () => {
    const host = document.createElement("div");
    host.appendChild(renderMarkdown("see https://example.com/page"));
    const link = host.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/page");
    expect(link?.getAttribute("rel") ?? "").toContain("noopener");
  });
});

describe("renderMarkdown formatting", () => {
  it("renders bold, italic and inline code", () => {
    const out = html("**bold** *italic* `code`");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain("<code");
  });

  it("renders a fenced block as code without interpreting its contents", () => {
    const out = html("```ts\nconst x = **not bold**;\n```");
    expect(out).toContain("<pre");
    expect(out).not.toContain("<strong>");
  });

  it("only highlights mentions the server recorded", () => {
    expect(html("hi @alice", new Set(["alice"]))).toContain("mention");
    expect(html("hi @mallory", new Set(["alice"]))).not.toContain("mention");
  });
});
