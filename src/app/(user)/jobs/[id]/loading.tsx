export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-3 motion-reduce:animate-none" aria-busy="true" aria-label="Loading">
      <div className="h-9 w-28 rounded bg-panel" />
      <div className="grid gap-8 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-14">
        <div className="mx-auto aspect-[9/16] w-full max-w-[min(340px,calc(60dvh*9/16))] rounded-2xl bg-panel md:mx-0 md:max-w-[340px]" />
        <div className="flex flex-col gap-4">
          <div className="h-8 w-3/4 rounded-lg bg-panel sm:h-9" />
          <div className="h-5 w-full max-w-md rounded bg-panel" />
          <div className="h-11 rounded-xl bg-panel" />
        </div>
      </div>
    </div>
  );
}
