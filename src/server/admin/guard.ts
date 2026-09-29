import "server-only";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import type { User } from "@/generated/prisma/client";
import { getViewer } from "@/server/session";

export type Admin = { id: string; email: string; name: string };

type UserRow = Pick<User, "role" | "isAnonymous" | "suspendedAt">;

/** Admin = a real (non-anonymous), non-suspended account with role 'admin' (CLAUDE.md §6). */
export const isAdmin = (u: UserRow | undefined | null) => !!u && u.role === "admin" && !u.isAnonymous && !u.suspendedAt;

/** The current admin, or null. Re-reads the user row: the session cookie cache may be minutes old. */
export async function currentAdmin(): Promise<Admin | null> {
  const viewer = await getViewer();
  if (!viewer) return null;
  const row = await db.user.findUnique({
    where: { id: viewer.id },
    select: { id: true, email: true, name: true, role: true, isAnonymous: true, suspendedAt: true },
  });
  return row && isAdmin(row) ? { id: row.id, email: row.email, name: row.name } : null;
}

/** For admin pages and layouts: sends non-admins to the sign-in page. */
export async function requireAdmin(): Promise<Admin> {
  const admin = await currentAdmin();
  if (!admin) redirect("/admin/sign-in");
  return admin;
}
