import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex max-w-lg flex-col gap-4">
      <h1 className="font-display text-2xl">We can&apos;t find that montage</h1>
      <p className="text-muted-foreground">
        The link may be wrong, or the montage belongs to another account. Everything you&apos;ve made is in My videos.
      </p>
      <Link href="/library" className={buttonVariants({ size: "lg", className: "self-start" })}>
        Go to My videos
      </Link>
    </div>
  );
}
