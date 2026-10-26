import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        success: "border-transparent bg-success text-success-foreground shadow hover:bg-success/80",
        warning: "border-transparent bg-warning text-warning-foreground shadow hover:bg-warning/80",
        outline: "text-foreground",
        // The five CLAUDE.md status markers, exposed as badge variants for
        // picklist/color-tag displays that need the exact spreadsheet hue
        // rather than a semantic (primary/success/...) alias.
        "status-magenta": "border-transparent bg-status-magenta text-white shadow hover:bg-status-magenta/80",
        "status-green": "border-transparent bg-status-green text-white shadow hover:bg-status-green/80",
        "status-yellow": "border-transparent bg-status-yellow text-black shadow hover:bg-status-yellow/80",
        "status-darkred": "border-transparent bg-status-darkred text-white shadow hover:bg-destructive/80",
        "status-orange": "border-transparent bg-status-orange text-white shadow hover:bg-status-orange/80",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
