// Same shape as the Create page (one screen on phones, preview taking the leftover height) so nothing shifts.
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-3 motion-reduce:animate-none max-lg:h-[calc(100dvh-6rem)] lg:grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start lg:gap-14" aria-busy="true" aria-label="Loading">
      <div className="flex min-h-36 flex-1 basis-0 justify-center lg:block lg:flex-none">
        <div className="aspect-[9/12] h-full max-w-full rounded-t-2xl bg-panel [mask-image:linear-gradient(to_bottom,#000_82%,transparent)] lg:aspect-[3/4] lg:h-auto lg:w-full lg:max-w-[340px] lg:rounded-2xl lg:[mask-image:none]" />
      </div>
      <div className="flex shrink-0 flex-col gap-3 lg:max-w-lg lg:gap-6">
        <div className="flex flex-col gap-3 max-lg:hidden">
          <div className="h-10 w-4/5 rounded-lg bg-panel" />
          <div className="h-5 w-full rounded bg-panel" />
        </div>
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-11 w-28 rounded-full bg-panel" />
          ))}
        </div>
        <div className="h-56 rounded-2xl bg-panel" />
        <div className="flex gap-3">
          <div className="h-14 w-40 rounded-xl bg-panel" />
          <div className="h-14 flex-1 rounded-xl bg-panel" />
        </div>
      </div>
    </div>
  );
}
