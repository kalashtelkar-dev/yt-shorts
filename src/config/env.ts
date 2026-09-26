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
    AUTH_MODE: z.enum(["anonymous", "full"]).default("anonymous"),
    ADMIN_EMAILS: csv,
    BETTER_AUTH_SECRET: z.string().optional(),
    DATABASE_URL: z.string().default("postgres://montage:montage@localhost:5432/montage"),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

    ENGINEX_MODE: z.enum(["live", "mock"]).default("live"),
    ENGINEX_BASE_URL: z.url().optional(),
    ENGINEX_API_KEY: z.string().min(1).optional(),
    ENGINEX_STORAGE_URL: z.url().optional(), // Engine X object store (MinIO), for the health check only

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().default("MontageAI <no-reply@example.com>"),

    PAYMENTS_ENABLED: bool,
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  })
  .superRefine((e, ctx) => {
    if (e.ENGINEX_MODE === "live" && (!e.ENGINEX_BASE_URL || !e.ENGINEX_API_KEY)) {
      ctx.addIssue({ code: "custom", message: "ENGINEX_BASE_URL and ENGINEX_API_KEY are required when ENGINEX_MODE=live" });
    }
    if (e.NODE_ENV === "production" && !e.BETTER_AUTH_SECRET) {
      ctx.addIssue({ code: "custom", message: "BETTER_AUTH_SECRET is required in production" });
    }
  });

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    // Only print variable names and messages, never values.
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`);
    throw new Error(`Invalid environment:\n${issues.join("\n")}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);
