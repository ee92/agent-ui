export function LoadingSkeleton({
  rows = 4,
  className = "h-14 rounded-lg"
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className={`animate-pulse border border-white/4 bg-white/[0.03] ${className}`}
        />
      ))}
    </div>
  );
}
