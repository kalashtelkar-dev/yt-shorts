import "server-only";
import { z } from "zod";

const csv = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );
const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    AUTH_MODE: z.enum(["anonymous", "full"]).default("full"),
    ADMIN_EMAILS: csv,
    BETTER_AUTH_SECRET: z.string().optional(),
    DATABASE_URL: z.string().default("postgres://montage:montage@localhost:5432/montage"),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

    ENGINEX_MODE: z.enum(["live", "mock"]).default("live"),
    ENGINEX_BASE_URL: z.url().optional(),
    ENGINEX_API_KEY: z.string().min(1).optional(),
    // Long-term storage for finished montages: the store-file pipeline copies each file into this bucket on this Engine X
    // Object Storage connection (pipelines/build.py, STORE_*), and the app plays it back through share links.
    ENGINEX_STORE_PIPELINE: z.string().min(1).optional(),
    ENGINEX_STORE_CONNECTION: z.string().min(1).optional(),
    ENGINEX_STORE_BUCKET: z.string().min(3).optional(),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().default("MontageAI <no-reply@example.com>"),

    // Google sign-in (AUTH_MODE=full only): a Google Cloud OAuth "Web application" client whose redirect URI is <APP_URL>/auth/google/callback.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    PAYMENTS_ENABLED: bool,
    PAYMENTS_PROVIDER: z.enum(["mock", "cashfree"]).default("mock"),
    CASHFREE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
    CASHFREE_APP_ID: z.string().optional(),
    CASHFREE_SECRET_KEY: z.string().optional(),
  })
  .superRefine((e, ctx) => {
    if (e.ENGINEX_MODE === "live" && (!e.ENGINEX_BASE_URL || !e.ENGINEX_API_KEY)) {
      ctx.addIssue({ code: "custom", message: "ENGINEX_BASE_URL and ENGINEX_API_KEY are required when ENGINEX_MODE=live" });
    }
    if ([e.ENGINEX_STORE_PIPELINE, e.ENGINEX_STORE_CONNECTION, e.ENGINEX_STORE_BUCKET].filter(Boolean).length % 3) {
      ctx.addIssue({ code: "custom", message: "ENGINEX_STORE_PIPELINE, ENGINEX_STORE_CONNECTION and ENGINEX_STORE_BUCKET go together: set all three or none" });
    }
    if (e.NODE_ENV === "production" && !e.BETTER_AUTH_SECRET) {
      ctx.addIssue({ code: "custom", message: "BETTER_AUTH_SECRET is required in production" });
    }
    if (e.PAYMENTS_ENABLED && e.PAYMENTS_PROVIDER === "mock" && e.NODE_ENV === "production") {
      ctx.addIssue({ code: "custom", message: "PAYMENTS_PROVIDER=mock can't run in production; use cashfree" });
    }
    if (e.PAYMENTS_ENABLED && e.PAYMENTS_PROVIDER === "cashfree" && (!e.CASHFREE_APP_ID || !e.CASHFREE_SECRET_KEY)) {
      ctx.addIssue({ code: "custom", message: "CASHFREE_APP_ID and CASHFREE_SECRET_KEY are required when PAYMENTS_PROVIDER=cashfree" });
    }
    if (e.NODE_ENV === "production" && e.AUTH_MODE === "full" && !e.SMTP_HOST) {
      ctx.addIssue({ code: "custom", message: "SMTP_HOST is required when AUTH_MODE=full (sign-up codes go by email)" });
    }
  });

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Empty values count as unset; SMTP_PASSWORD is accepted as another name for SMTP_PASS.
  const clean = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const result = schema.safeParse({ ...clean, SMTP_PASS: clean.SMTP_PASS ?? clean.SMTP_PASSWORD });
  if (!result.success) {
    // Only print variable names and messages, never values.
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`);
    throw new Error(`Invalid environment:\n${issues.join("\n")}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);
