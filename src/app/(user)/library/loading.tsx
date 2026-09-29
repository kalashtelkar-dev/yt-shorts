// Same shape as My videos so nothing shifts when it loads.
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-5 motion-reduce:animate-none" aria-busy="true" aria-label="Loading">
      <div className="flex items-center justify-between gap-4">
        <div className="h-8 w-40 rounded-lg bg-panel sm:h-9" />
        <div className="h-11 w-32 rounded-lg bg-panel sm:h-10" />
      </div>
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 w-20 rounded-full bg-panel" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="aspect-[9/16] rounded-xl bg-panel" />
            <div className="h-4 w-3/4 rounded bg-panel" />
            <div className="h-4 w-1/2 rounded bg-panel" />
          </div>
        ))}
      </div>
    </div>
  );
}
