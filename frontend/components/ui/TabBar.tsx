"use client";

/** fixes98: a row of pill tabs (same look as the translations page's screen
 *  tabs). Wraps on narrow screens; 36px+ touch targets. */
export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`min-h-[36px] rounded-full border px-3 text-sm transition-colors ${
              active
                ? "border-primary bg-gradient-to-b from-primary/95 to-primary text-primary-foreground shadow-glow"
                : "border-white/10 bg-white/5 hover:bg-white/10"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
