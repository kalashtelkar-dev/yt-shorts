import "server-only";
import { db } from "@/db/client";
import { transferBalance } from "./credits";

/**
 * A guest signed up or signed in: their videos and credits move to the account, in one transaction.
 * Jobs still running keep going; their refunds (if any) land on the account because the job row moved.
 * ponytail: uploads issued to the guest but not yet used stay tied to the guest (they expire in 24 h).
 */
export async function mergeGuest(guestId: string, userId: string): Promise<void> {
  if (guestId === userId) return;
  await db.$transaction(async (tx) => {
    await tx.job.updateMany({ where: { userId: guestId }, data: { userId } });
    await transferBalance(tx, guestId, userId, "Moved from your guest session");
  });
}
