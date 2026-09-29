// Same shape as the Account page (tabs, the buy card, the balance column) so nothing shifts when it loads.
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6 motion-reduce:animate-none" aria-busy="true" aria-label="Loading">
      <div className="-mb-3 h-9 w-20 rounded bg-panel" />
      <div className="h-[3.25rem] max-w-md rounded-xl bg-panel" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:gap-14">
        <div className="flex flex-col gap-4">
          <div className="h-9 w-48 rounded-lg bg-panel" />
          <div className="h-[260px] rounded-2xl bg-panel" />
          <div className="h-32 rounded-xl bg-panel" />
          <div className="h-13 rounded-xl bg-panel" />
        </div>
        <div className="flex flex-col gap-4 max-lg:hidden">
          <div className="h-24 rounded-2xl bg-panel" />
          <div className="h-36 rounded-2xl bg-panel" />
        </div>
      </div>
    </div>
  );
}
