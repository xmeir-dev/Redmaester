import { cn } from "@/lib/utils";

type StatItem = {
  label: string;
  value: React.ReactNode;
};

export function SiteHeader({
  brand,
  stats,
  actions,
}: {
  brand: React.ReactNode;
  stats?: StatItem[];
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex h-12 items-stretch">
      {/* Scrollable brand + stats region */}
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {/* Brand */}
        <div className="flex shrink-0 items-center border-r border-[hsl(var(--border))] px-5">
          {brand}
        </div>

        {/* Stats */}
        {stats && stats.length > 0 ? (
          <div className="flex items-stretch divide-x divide-[hsl(var(--border))]">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="flex shrink-0 items-center gap-1.5 px-5 text-sm"
              >
                <span className="text-black/30">{stat.label}</span>
                <span className="tabular-nums text-black/70">{stat.value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Actions — outside the overflow region so dropdown is never clipped */}
      {actions ? (
        <div className="flex shrink-0 items-center px-4">{actions}</div>
      ) : null}
    </div>
  );
}
