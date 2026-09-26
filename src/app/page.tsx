import { brand } from "@/config/brand";

// Placeholder shell. The real Create page (catalog-driven form) lands in milestone 6.
export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 sm:px-6">
      <header className="flex h-14 items-center justify-between border-b">
        <span className="font-semibold tracking-tight">{brand.name}</span>
      </header>
      <main className="flex flex-1 flex-col justify-center gap-3 py-12">
        <h1 className="max-w-xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {brand.tagline}
        </h1>
        <p className="max-w-prose text-muted-foreground">{brand.description}</p>
      </main>
    </div>
  );
}
