// The Jobs page's shape while it loads: the live queue header, the list beside the job, then the folded run times.
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-4 motion-reduce:animate-none" aria-busy="true" aria-label="Loading">
      <div className="flex flex-wrap items-center gap-4">
        <div className="h-8 w-40 rounded-lg bg-panel" />
        <div className="h-14 w-36 rounded-xl bg-panel" />
        <div className="h-14 w-32 rounded-xl bg-panel" />
      </div>
      <div className="h-[44rem] rounded-xl bg-panel" />
      <div className="h-12 rounded-xl bg-panel" />
    </div>
  );
}
