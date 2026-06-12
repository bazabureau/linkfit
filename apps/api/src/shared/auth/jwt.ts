import jwt from "jsonwebtoken";

export interface AccessTokenClaims {
  sub: string; // user id
  iat: number;
  exp: number;
  /**
   * Refresh-token family id ("session id"). Optional because tokens minted
   * before the sessions-metadata migration carry no claim — the guard
   * surfaces `undefined` so the sessions service can treat such tokens as
   * "session not identifiable" rather than failing the request.
   *
   * Every fresh mint (register / login / refresh / OAuth) populates it so
   * subsequent calls to `GET /api/v1/me/sessions` can flag the row whose
   * `family_id` matches as `is_current: true`.
   */
  sid?: string;
}

export interface SignOptions {
  secret: string;
  ttlSeconds: number;
  /**
   * Refresh-token family id that owns this access token. Embedded as the
   * `sid` claim. Omit only for legacy paths that haven't been threaded
   * through yet — every production caller should pass it.
   */
  familyId?: string;
}

export function signAccessToken(userId: string, options: SignOptions): string {
  const payload: { sub: string; sid?: string } = { sub: userId };
  if (options.familyId !== undefined) payload.sid = options.familyId;
  return jwt.sign(payload, options.secret, {
    algorithm: "HS256",
    expiresIn: options.ttlSeconds,
  });
}

export class InvalidAccessTokenError extends Error {
  public override readonly name = "InvalidAccessTokenError";
  constructor(public readonly reason: "missing" | "malformed" | "expired" | "signature") {
    super(`Invalid access token: ${reason}`);
  }
}

export function verifyAccessToken(token: string, secret: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof decoded !== "object") {
      throw new InvalidAccessTokenError("malformed");
    }
    const claims = decoded as Partial<AccessTokenClaims>;
    if (typeof claims.sub !== "string" || typeof claims.iat !== "number" || typeof claims.exp !== "number") {
      throw new InvalidAccessTokenError("malformed");
    }
    const out: AccessTokenClaims = { sub: claims.sub, iat: claims.iat, exp: claims.exp };
    // `sid` is optional — present for tokens minted after the sessions
    // migration. We pass it through when valid; reject only on a wrong type.
    if (claims.sid !== undefined) {
      if (typeof claims.sid !== "string") {
        throw new InvalidAccessTokenError("malformed");
      }
      out.sid = claims.sid;
    }
    return out;
  } catch (err) {
    if (err instanceof InvalidAccessTokenError) throw err;
    if (err instanceof jwt.TokenExpiredError) throw new InvalidAccessTokenError("expired");
    if (err instanceof jwt.JsonWebTokenError) throw new InvalidAccessTokenError("signature");
    throw new InvalidAccessTokenError("malformed");
  }
}
