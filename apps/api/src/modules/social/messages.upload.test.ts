import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { URL } from "node:url";
import { buildServer, type LinkfitServer } from "../../shared/http/server.js";
import { buildTestDb } from "../../../tests/helpers/db.js";
import { buildTestEnv } from "../../../tests/helpers/env.js";
import { createTestUser, truncateAll } from "../../../tests/helpers/fixtures.js";
import { type DbHandle } from "../../shared/db/pool.js";
import { type Env } from "../../shared/config/env.js";

/**
 * Exercises the upload endpoint AND the `/uploads/*` static route registered
 * on the same server. The previous version returned `file://...` paths that
 * no client could ever fetch — these tests guard the regression by asserting
 * the URL is HTTP and is actually reachable through Fastify itself.
 */

interface UploadResponse {
  url: string;
}

// Tiny 1x1 PNG — smallest valid PNG, decoded from a well-known base64.
const ONE_PX_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABXvMqOgAAAABJRU5ErkJggg==";

function buildMultipart(field: string, filename: string, contentType: string, body: Buffer): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const boundary = `----linkfit-test-${Math.random().toString(36).slice(2)}`;
  const header =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  const payload = Buffer.concat([Buffer.from(header), body, Buffer.from(footer)]);
  return {
    payload,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(payload.length),
    },
  };
}

describe("messages upload endpoint", () => {
  const env: Env = buildTestEnv();
  let app: LinkfitServer;
  let db: DbHandle;

  beforeAll(async () => {
    db = buildTestDb();
    app = await buildServer({ env, logger: pino({ level: "silent" }), db });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it("uploads a PNG and returns an http(s) URL pointing at /uploads/", async () => {
    const alice = await createTestUser(app);
    const png = Buffer.from(ONE_PX_PNG_BASE64, "base64");
    const { payload, headers } = buildMultipart("file", "tiny.png", "image/png", png);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/messages/upload-image",
      headers: { ...headers, authorization: `Bearer ${alice.access_token}` },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<UploadResponse>();
    // No more file:// — these are unfetchable from clients.
    expect(body.url.startsWith("file://")).toBe(false);
    expect(body.url).toMatch(/^https?:\/\//);
    const parsed = new URL(body.url);
    expect(parsed.pathname.startsWith("/uploads/")).toBe(true);

    // The file was actually written to disk under the configured dir.
    const filename = parsed.pathname.slice("/uploads/".length);
    const onDisk = `${env.UPLOAD_DIR}/${filename}`;
    expect(existsSync(onDisk)).toBe(true);
    const written = await readFile(onDisk);
    expect(written.equals(png)).toBe(true);
  });

  it("the returned URL is fetchable through the same server", async () => {
    const alice = await createTestUser(app);
    const png = Buffer.from(ONE_PX_PNG_BASE64, "base64");
    const { payload, headers } = buildMultipart("file", "tiny.png", "image/png", png);

    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/messages/upload-image",
      headers: { ...headers, authorization: `Bearer ${alice.access_token}` },
      payload,
    });
    const { url } = upload.json<UploadResponse>();
    const pathname = new URL(url).pathname;

    // Inject directly — confirms the static route is wired and serves bytes.
    const get = await app.inject({ method: "GET", url: pathname });
    expect(get.statusCode).toBe(200);
    expect(get.headers["content-type"]).toMatch(/^image\/png/);
    expect(get.rawPayload.equals(png)).toBe(true);
  });

  it("rejects non-image content types with 400", async () => {
    const alice = await createTestUser(app);
    const { payload, headers } = buildMultipart(
      "file",
      "evil.txt",
      "text/plain",
      Buffer.from("not an image"),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/messages/upload-image",
      headers: { ...headers, authorization: `Bearer ${alice.access_token}` },
      payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it("requires authentication", async () => {
    const png = Buffer.from(ONE_PX_PNG_BASE64, "base64");
    const { payload, headers } = buildMultipart("file", "tiny.png", "image/png", png);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/messages/upload-image",
      headers,
      payload,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects multipart upload with no file field at all (no 'file' part)", async () => {
    const alice = await createTestUser(app);
    // Build a multipart body whose single field is named 'something_else',
    // not the expected 'file'. The route's `req.file()` returns undefined,
    // which the handler must surface as a 400 ValidationError — NOT a 500.
    const boundary = `----linkfit-no-file-${Math.random().toString(36).slice(2)}`;
    const payload = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="something_else"\r\n\r\n` +
        `not-a-file\r\n` +
        `--${boundary}--\r\n`,
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/messages/upload-image",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": String(payload.length),
        authorization: `Bearer ${alice.access_token}`,
      },
      payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it("two concurrent uploads from the same user produce distinct, addressable files", async () => {
    // The handler names each upload `${randomUUID()}.ext` — verify the
    // collision-free guarantee under parallel pressure. Both URLs must
    // resolve to the bytes their request sent, with no cross-contamination.
    const alice = await createTestUser(app);
    const png = Buffer.from(ONE_PX_PNG_BASE64, "base64");

    const issue = async (): Promise<UploadResponse> => {
      const { payload, headers } = buildMultipart("file", "p.png", "image/png", png);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/messages/upload-image",
        headers: { ...headers, authorization: `Bearer ${alice.access_token}` },
        payload,
      });
      expect(res.statusCode).toBe(200);
      return res.json<UploadResponse>();
    };

    const [a, b] = await Promise.all([issue(), issue()]);
    expect(a.url).not.toBe(b.url);

    for (const url of [a.url, b.url]) {
      const get = await app.inject({ method: "GET", url: new URL(url).pathname });
      expect(get.statusCode).toBe(200);
      expect(get.rawPayload.equals(png)).toBe(true);
    }
  });

  it("a sent message with attachment_url references the uploaded image", async () => {
    const alice = await createTestUser(app);
    const bob = await createTestUser(app);

    // Open a conversation Alice → Bob.
    const conv = await app.inject({
      method: "POST",
      url: "/api/v1/conversations",
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { other_user_id: bob.id },
    });
    expect(conv.statusCode).toBe(200);
    const { conversation_id: conversationId } = conv.json<{ conversation_id: string }>();

    // Upload an image as Alice.
    const png = Buffer.from(ONE_PX_PNG_BASE64, "base64");
    const { payload, headers } = buildMultipart("file", "shot.png", "image/png", png);
    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/messages/upload-image",
      headers: { ...headers, authorization: `Bearer ${alice.access_token}` },
      payload,
    });
    expect(upload.statusCode).toBe(200);
    const { url } = upload.json<UploadResponse>();

    // Send the image as a message — body is empty.
    const send = await app.inject({
      method: "POST",
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: { authorization: `Bearer ${alice.access_token}` },
      payload: { attachment_url: url, attachment_type: "image" },
    });
    expect(send.statusCode).toBe(201);
    const sent = send.json<{ attachment_url: string; attachment_type: string; body: string }>();
    expect(sent.attachment_url).toBe(url);
    expect(sent.attachment_type).toBe("image");
    expect(sent.body).toBe("");

    // And the URL is still fetchable.
    const get = await app.inject({ method: "GET", url: new URL(url).pathname });
    expect(get.statusCode).toBe(200);
  });
});
