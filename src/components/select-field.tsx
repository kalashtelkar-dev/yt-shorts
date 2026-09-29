"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string };

/**
 * A dropdown whose open list is styled too (the browser's own <select> list follows the OS, not our theme).
 * Submits with its form under `name`, like a native select.
 */
export function SelectField({
  name,
  label,
  options,
  defaultValue,
  placeholder,
  required,
  invalid,
  className,
}: {
  name: string;
  /** Accessible name when there's no visible label pointing at it. */
  label: string;
  options: SelectOption[];
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <Select name={name} items={options} defaultValue={defaultValue ?? null} required={required}>
      <SelectTrigger
        aria-label={label}
        aria-invalid={invalid || undefined}
        className={cn(
          "h-11 w-full bg-panel-raised px-3 data-[size=default]:h-11 sm:data-[size=default]:h-10 text-base hover:border-muted-foreground/50 sm:h-10 sm:text-sm dark:bg-panel-raised dark:hover:bg-panel-raised",
          // An empty-value option like "All statuses" is a real choice, not a hint: keep it white.
          !placeholder && "data-placeholder:text-foreground",
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="border border-input bg-panel-raised p-1">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="min-h-9 py-2 pl-2.5 text-sm focus:bg-input data-selected:font-medium">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
