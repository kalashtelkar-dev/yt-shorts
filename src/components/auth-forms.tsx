"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useId, useState } from "react";
import { type AuthState, changePasswordAction, forgotAction, resendAction, resetAction, signInAction, signUpAction, verifyAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/password-input";
import { cn } from "@/lib/utils";

// Every form is a React form action: it works before hydration and shows a pending state.

function Message({ state, id }: { state: AuthState; id?: string }) {
  if (!state) return null;
  return (
    <p id={id} role={state.ok ? "status" : "alert"} className={cn("text-sm", state.ok ? "text-muted-foreground" : "text-danger")}>
      {state.message}
    </p>
  );
}

function Submit({ pending, children, pendingText }: { pending: boolean; children: React.ReactNode; pendingText: string }) {
  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full">
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending ? pendingText : children}
    </Button>
  );
}

function EmailField({ state }: { state: AuthState }) {
  const invalid = state?.field === "email";
  return (
    <div className="grid gap-2">
      <Label htmlFor="email">Email</Label>
      <Input
        id="email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="off"
        spellCheck={false}
        required
        maxLength={254}
        placeholder="you@example.com"
        defaultValue={state?.email}
        aria-invalid={invalid}
      />
    </div>
  );
}

function PasswordField({ state, isNew, label = "Password" }: { state: AuthState; isNew: boolean; label?: string }) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <PasswordInput
        id={id}
        name="password"
        autoComplete={isNew ? "new-password" : "current-password"}
        placeholder={isNew ? "At least 8 characters" : undefined}
        required
        minLength={isNew ? 8 : undefined}
        maxLength={128}
        aria-invalid={state?.field === "password"}
      />
    </div>
  );
}

/** One real input under six display boxes, so paste and one-time-code autofill just work. */
function CodeField({ state }: { state: AuthState }) {
  const [code, setCode] = useState("");
  const [focused, setFocused] = useState(true);
  return (
    <div className="grid gap-2">
      <Label htmlFor="otp">6-digit code</Label>
      <div className="relative">
        <div className="grid grid-cols-6 gap-2" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <span
              key={i}
              className={cn(
                "flex h-12 items-center justify-center rounded-lg border bg-panel font-mono text-xl tabular sm:h-14",
                focused && i === Math.min(code.length, 5) ? "border-danger" : code[i] ? "border-input" : "border-border",
                state?.field === "otp" && "border-danger/60",
              )}
            >
              {code[i]}
            </span>
          ))}
        </div>
        <input
          id="otp"
          name="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="absolute inset-0 size-full cursor-text opacity-0"
          aria-invalid={state?.field === "otp"}
        />
      </div>
    </div>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, null);
  return (
    <form action={action} className="flex flex-col gap-5">
      <EmailField state={state} />
      <PasswordField state={state} isNew />
      <Message state={state} />
      <Submit pending={pending} pendingText="Creating your account…">
        Create my account
      </Submit>
    </form>
  );
}

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, null);
  return (
    <form action={action} className="flex flex-col gap-5">
      <EmailField state={state} />
      <PasswordField state={state} isNew={false} />
      <Message state={state} />
      <Submit pending={pending} pendingText="Signing in…">
        Sign in
      </Submit>
    </form>
  );
}

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyAction, null);
  return (
    <form action={action} className="flex flex-col gap-5">
      <CodeField state={state} />
      <Message state={state} />
      <Submit pending={pending} pendingText="Checking…">
        Confirm my email
      </Submit>
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(forgotAction, null);
  return (
    <form action={action} className="flex flex-col gap-5">
      <EmailField state={state} />
      <Message state={state} />
      <Submit pending={pending} pendingText="Sending…">
        Send me a code
      </Submit>
    </form>
  );
}

export function ResetForm() {
  const [state, action, pending] = useActionState(resetAction, null);
  return (
    <form action={action} className="flex flex-col gap-5">
      <CodeField state={state} />
      <PasswordField state={state} isNew label="New password" />
      <Message state={state} />
      <Submit pending={pending} pendingText="Saving…">
        Save my new password
      </Submit>
    </form>
  );
}

export function ResendCode({ purpose }: { purpose: "email-verification" | "forget-password" }) {
  const [state, action, pending] = useActionState(resendAction, null);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="purpose" value={purpose} />
      <button type="submit" disabled={pending} className="rounded text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60">
        {pending ? "Sending…" : "Send a new code"}
      </button>
      <Message state={state} />
    </form>
  );
}

export function ChangePasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(changePasswordAction, null);
  return (
    <form action={action} className="flex flex-col gap-5">
      {/* Lets password managers file the new password under the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div className="grid gap-2">
        <Label htmlFor="currentPassword">Current password</Label>
        <PasswordInput id="currentPassword" name="currentPassword" autoComplete="current-password" required maxLength={128} aria-invalid={state?.field === "currentPassword"} />
      </div>
      <PasswordField state={state} isNew label="New password" />
      <Message state={state} />
      <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto sm:self-start">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}
