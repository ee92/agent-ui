export function OfflineBanner({ visible, detail }: { visible: boolean; detail: string }) {
  if (!visible) {
    return null;
  }
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
      Offline mode. Messages queue locally until the gateway reconnects.
      {detail ? <span className="ml-2 text-amber-200/70">{detail}</span> : null}
    </div>
  );
}
