import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { buildAuthGuard, requireUserId } from "./guard.js";
import { signAccessToken } from "./jwt.js";
import { UnauthenticatedError } from "../errors/AppError.js";
import { type FastifyReply, type FastifyRequest } from "fastify";

const SECRET = "x".repeat(32);
const guard = buildAuthGuard({ jwtAccessSecret: SECRET });

function makeReq(headers: Record<string, string | undefined>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}
const dummyReply = {} as FastifyReply;

function signWith(secret: string, opts: jwt.SignOptions = {}): string {
  return jwt.sign({ sub: "user-x" }, secret, { algorithm: "HS256", ...opts });
}

describe("auth guard", () => {
  it("populates authUserId when token is valid", async () => {
    const token = signAccessToken("user-1", { secret: SECRET, ttlSeconds: 60 });
    const req = makeReq({ authorization: `Bearer ${token}` });
    await guard(req, dummyReply);
    expect(req.authUserId).toBe("user-1");
    expect(requireUserId(req)).toBe("user-1");
  });

  it("rejects missing Authorization header", async () => {
    await expect(guard(makeReq({}), dummyReply)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects non-Bearer scheme", async () => {
    await expect(
      guard(makeReq({ authorization: "Basic abc" }), dummyReply),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects empty bearer", async () => {
    await expect(
      guard(makeReq({ authorization: "Bearer " }), dummyReply),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects token signed with a different secret", async () => {
    const wrong = signWith("y".repeat(32));
    await expect(
      guard(makeReq({ authorization: `Bearer ${wrong}` }), dummyReply),
    ).rejects.toThrow(/Invalid/);
  });

  it("rejects expired token with a specific message", async () => {
    const expired = signWith(SECRET, { expiresIn: "-1s" });
    await expect(
      guard(makeReq({ authorization: `Bearer ${expired}` }), dummyReply),
    ).rejects.toThrow(/expired/);
  });

  it("requireUserId throws when guard never ran", () => {
    expect(() => requireUserId(makeReq({}))).toThrow(UnauthenticatedError);
  });
});
