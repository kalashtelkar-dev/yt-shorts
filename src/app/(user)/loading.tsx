// Same shape as the Create page so nothing shifts when it loads.
export default function Loading() {
  return (
    <div className="grid animate-pulse gap-10 lg:grid-cols-[minmax(0,1fr)_300px] xl:gap-16 motion-reduce:animate-none" aria-busy="true" aria-label="Loading">
      <div className="flex max-w-lg flex-col gap-8 sm:gap-10">
        <div className="flex flex-col gap-3">
          <div className="h-9 w-4/5 rounded-lg bg-panel sm:h-10" />
          <div className="h-5 w-full rounded bg-panel" />
        </div>
        <div className="flex flex-col gap-6">
          {[0, 1].map((i) => (
            <div key={i} className="grid gap-2">
              <div className="h-4 w-28 rounded bg-panel" />
              <div className="h-11 rounded-lg bg-panel sm:h-10" />
              <div className="h-4 w-56 rounded bg-panel" />
            </div>
          ))}
          <div className="h-11 rounded-xl bg-panel sm:h-12" />
          <div className="h-12 w-44 rounded-lg bg-panel" />
        </div>
      </div>
      <div className="hidden aspect-[9/16] rounded-2xl bg-panel lg:block" />
    </div>
  );
}
