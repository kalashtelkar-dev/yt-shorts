export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6 motion-reduce:animate-none" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-40 rounded-lg bg-panel sm:h-9" />
      <div className="flex flex-col divide-y rounded-xl border bg-panel">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex min-h-16 flex-col justify-center gap-2 px-4 py-3">
            <div className="h-4 w-1/2 rounded bg-panel-raised" />
            <div className="h-3 w-1/3 rounded bg-panel-raised" />
          </div>
        ))}
      </div>
    </div>
  );
}
