"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import type { FormState } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A form bound to an admin server action, with pending state and the action's result message. */
export function ActionForm({
  action,
  submitLabel,
  variant = "default",
  className,
  children,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  submitLabel: string;
  variant?: "default" | "outline" | "destructive" | "secondary";
  className?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={cn("flex flex-col gap-3", className)}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={variant} disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {submitLabel}
        </Button>
        {state && (
          <p role="status" className={cn("text-sm", state.ok ? "text-success" : "text-danger")}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
