import { describe, expect, it } from "vitest";
import { authFailed, resolveHold, senderAllowed } from "./allowlist";
import type { ParsedAuthResults } from "./types";
import type { Env } from "./types";

describe("senderAllowed", () => {
  it("matches an exact address case-insensitively", () => {
    expect(senderAllowed("Nana@Example.com", ["nana@example.com"])).toBe(true);
  });

  it("matches a whole domain pattern", () => {
    expect(senderAllowed("teacher@school.org", ["@school.org"])).toBe(true);
  });

  it("does not match a different or look-alike domain", () => {
    expect(senderAllowed("x@evilschool.org", ["@school.org"])).toBe(false);
    expect(senderAllowed("x@school.org.evil.com", ["@school.org"])).toBe(false);
  });

  it("does not let a bare domain pattern match an address by suffix", () => {
    expect(senderAllowed("x@school.org", ["school.org"])).toBe(false);
  });

  it("rejects empty list and malformed addresses", () => {
    expect(senderAllowed("a@b.com", [])).toBe(false);
    expect(senderAllowed("nobody", ["@b.com"])).toBe(false);
  });
});

describe("authFailed", () => {
  const base: ParsedAuthResults = { spf: "pass", dkim: "pass", dmarc: "pass", from_domain: "a.com" };
  it("flags only a DMARC fail", () => {
    expect(authFailed({ ...base, dmarc: "fail" })).toBe(true);
    expect(authFailed({ ...base, dmarc: "none" })).toBe(false);
    expect(authFailed(null)).toBe(false);
  });
});

// Minimal D1 stub: answers the three queries resolveHold issues.
function fakeEnv(opts: { hold: number; patterns: string[]; heldId: string | null }): Env {
  const prepare = (sql: string) => ({
    bind: () => ({
      first: async () =>
        sql.includes("hold_unknown")
          ? { hold_unknown: opts.hold }
          : opts.heldId
            ? { id: opts.heldId }
            : null,
      all: async () => ({ results: opts.patterns.map((pattern) => ({ pattern })) }),
    }),
  });
  return { DB: { prepare } } as unknown as Env;
}

const rcpt = { domainId: "d", mailboxId: "kid" };

describe("resolveHold", () => {
  it("delivers normally when the mailbox is not restricted", async () => {
    const r = await resolveHold(fakeEnv({ hold: 0, patterns: [], heldId: "h" }), rcpt, "x@y.com", null);
    expect(r).toMatchObject({ mailboxId: "kid", held: false });
  });

  it("holds an unknown sender for a restricted mailbox", async () => {
    const r = await resolveHold(fakeEnv({ hold: 1, patterns: ["a@b.com"], heldId: "h" }), rcpt, "x@y.com", null);
    expect(r).toMatchObject({ mailboxId: "h", held: true });
  });

  it("delivers an allowlisted sender", async () => {
    const r = await resolveHold(fakeEnv({ hold: 1, patterns: ["a@b.com"], heldId: "h" }), rcpt, "a@b.com", null);
    expect(r).toMatchObject({ mailboxId: "kid", held: false });
  });

  it("holds an allowlisted address that fails DMARC", async () => {
    const auth: ParsedAuthResults = { spf: "fail", dkim: "none", dmarc: "fail", from_domain: "b.com" };
    const r = await resolveHold(fakeEnv({ hold: 1, patterns: ["a@b.com"], heldId: "h" }), rcpt, "a@b.com", auth);
    expect(r).toMatchObject({ mailboxId: "h", held: true });
  });

  it("fails open when no held mailbox exists", async () => {
    const r = await resolveHold(fakeEnv({ hold: 1, patterns: [], heldId: null }), rcpt, "x@y.com", null);
    expect(r).toMatchObject({ mailboxId: "kid", held: false });
  });
});
