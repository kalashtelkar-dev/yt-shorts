"use client";

import { Loader2 } from "lucide-react";
import { startTransition, useActionState, useEffect, useRef } from "react";
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
  const ref = useRef<HTMLFormElement>(null);
  // Keep what was typed when the action refuses; clear it after success so it isn't applied twice.
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form ref={ref} onSubmit={submit} className={cn("flex flex-col gap-3", className)}>
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
