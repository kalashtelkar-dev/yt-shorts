import { redirect } from "next/navigation";

// The admin opens on Service health (the old Overview page was removed on request).
export default function AdminHome() {
  redirect("/admin/health");
}
