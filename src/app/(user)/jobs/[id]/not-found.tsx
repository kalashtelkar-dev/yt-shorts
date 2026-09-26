import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex max-w-lg flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">We can&apos;t find that montage</h1>
      <p className="text-muted-foreground">
        It may have been made in another browser. Montages stay with the browser that made them until accounts arrive.
      </p>
      <Link href="/" className={buttonVariants({ size: "lg", className: "self-start" })}>
        Make a montage
      </Link>
    </div>
  );
}
