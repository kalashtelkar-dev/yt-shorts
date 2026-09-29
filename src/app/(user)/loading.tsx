// Same shape as the Create page so nothing shifts when it loads.
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-5 motion-reduce:animate-none lg:grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start lg:gap-14" aria-busy="true" aria-label="Loading">
      <div className="mx-auto aspect-[9/12] w-full max-w-[min(16rem,calc(52dvh*9/16))] rounded-t-2xl bg-panel [mask-image:linear-gradient(to_bottom,#000_82%,transparent)] lg:mx-0 lg:aspect-[9/16] lg:max-w-[340px] lg:rounded-2xl lg:[mask-image:none]" />
      <div className="flex flex-col gap-4 lg:max-w-lg lg:gap-6">
        <div className="flex flex-col gap-3 max-lg:hidden">
          <div className="h-10 w-4/5 rounded-lg bg-panel" />
          <div className="h-5 w-full rounded bg-panel" />
        </div>
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-11 w-28 rounded-full bg-panel" />
          ))}
        </div>
        <div className="h-10 rounded bg-panel" />
        <div className="h-60 rounded-2xl bg-panel" />
        <div className="flex gap-3">
          <div className="h-14 w-40 rounded-xl bg-panel" />
          <div className="h-14 flex-1 rounded-xl bg-panel" />
        </div>
      </div>
    </div>
  );
}
