// Same shape as the account page: heading, details panel, password form.
export default function Loading() {
  return (
    <div className="flex max-w-lg animate-pulse flex-col gap-10 motion-reduce:animate-none" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 rounded-lg bg-panel sm:h-9" />
      <div className="h-[8.5rem] rounded-xl bg-panel" />
      <div className="flex flex-col gap-5">
        <div className="h-6 w-40 rounded bg-panel" />
        {[0, 1].map((i) => (
          <div key={i} className="grid gap-2">
            <div className="h-4 w-32 rounded bg-panel" />
            <div className="h-11 rounded-lg bg-panel sm:h-10" />
          </div>
        ))}
        <div className="h-12 w-44 rounded-lg bg-panel" />
      </div>
    </div>
  );
}
