import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LoginRequest, Me, SignupRequest } from "@bb/shared";
import { getDb } from "./db/index.ts";
import { sessions, users } from "./db/schema.ts";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = "bb_session";
const SESSION_DAYS = 60;
const USERNAME = /^[a-z0-9_]{3,20}$/;
const MIN_PASSWORD = 6;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const toMe = (u: typeof users.$inferSelect): Me => ({ id: u.id, username: u.username, displayName: u.displayName, coins: u.coins, tutorial: u.tutorialStatus });

declare module "fastify" {
  interface FastifyRequest { user: Me | null }
}

async function startSession(reply: FastifyReply, userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await getDb().insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt });
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", expires: expiresAt,
  });
}

/** Simple per-IP limit on login/signup attempts: 10 per 10 minutes. */
const attempts = new Map<string, { count: number; resetAt: number }>();
function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.resetAt < now) { attempts.set(ip, { count: 1, resetAt: now + 600_000 }); return false; }
  a.count++;
  return a.count > 10;
}

/** Use as a preHandler on routes that need a signed-in user. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) return reply.code(401).send({ error: "Please sign in." });
}

/**
 * Look up the signed-in user from the session cookie. Registered on the root app
 * (Fastify hooks added inside a plugin only apply to that plugin's routes).
 */
export function attachUser(app: FastifyInstance) {
  app.decorateRequest("user", null);
  app.addHook("preHandler", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const [row] = await getDb().select({ user: users }).from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
    req.user = row ? toMe(row.user) : null;
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: SignupRequest }>("/api/auth/signup", async (req, reply) => {
    if (tooManyAttempts(req.ip)) return reply.code(429).send({ error: "Too many tries. Wait a few minutes." });
    const username = String(req.body?.username ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const displayName = String(req.body?.displayName ?? "").trim().slice(0, 30) || username;
    if (!USERNAME.test(username)) return reply.code(400).send({ error: "Username: 3-20 letters, numbers or _." });
    if (password.length < MIN_PASSWORD) return reply.code(400).send({ error: `Password: at least ${MIN_PASSWORD} characters.` });

    const db = getDb();
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
    if (exists) return reply.code(409).send({ error: "That username is taken." });
    const [user] = await db.insert(users).values({ username, displayName, passwordHash: await hashPassword(password) }).returning();
    await startSession(reply, user.id);
    return reply.code(201).send(toMe(user));
  });

  app.post<{ Body: LoginRequest }>("/api/auth/login", async (req, reply) => {
    if (tooManyAttempts(req.ip)) return reply.code(429).send({ error: "Too many tries. Wait a few minutes." });
    const username = String(req.body?.username ?? "").trim().toLowerCase();
    const [user] = await getDb().select().from(users).where(eq(users.username, username));
    if (!user || !(await verifyPassword(String(req.body?.password ?? ""), user.passwordHash))) {
      return reply.code(401).send({ error: "Wrong username or password." });
    }
    await startSession(reply, user.id);
    return toMe(user);
  });

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await getDb().delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", async (req, reply) => req.user ?? reply.code(401).send({ error: "Not signed in." }));
}
