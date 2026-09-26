// Same shape as the auth pages: heading, two fields, one button.
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-8 motion-reduce:animate-none" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <div className="h-8 w-3/4 rounded-lg bg-panel" />
        <div className="h-5 w-full rounded bg-panel" />
      </div>
      <div className="flex flex-col gap-5">
        {[0, 1].map((i) => (
          <div key={i} className="grid gap-2">
            <div className="h-4 w-20 rounded bg-panel" />
            <div className="h-11 rounded-lg bg-panel sm:h-10" />
          </div>
        ))}
        <div className="h-12 rounded-lg bg-panel" />
      </div>
    </div>
  );
}
