"use client";

import { Eye, EyeOff } from "lucide-react";
import * as React from "react";

import { useLocalization } from "@/lib/localization";
import { cn } from "@/lib/utils";

export interface PasswordInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, dir, ...props }, ref) => {
    const [showPassword, setShowPassword] = React.useState(false);
    const { t } = useLocalization();

    return (
      <div className="relative w-full">
        <input
          type={showPassword ? "text" : "password"}
          dir={dir || "ltr"}
          className={cn(
            "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-10 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          ref={ref}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShowPassword((prev) => !prev)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
          title={
            showPassword
              ? t("auth.hide_password", "הסתר סיסמה")
              : t("auth.show_password", "הצג סיסמה")
          }
          aria-label={
            showPassword
              ? t("auth.hide_password", "הסתר סיסמה")
              : t("auth.show_password", "הצג סיסמה")
          }
        >
          {showPassword ? (
            <EyeOff className="h-4 w-4 select-none" />
          ) : (
            <Eye className="h-4 w-4 select-none" />
          )}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
