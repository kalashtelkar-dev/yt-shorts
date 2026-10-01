"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { type AuthState, accountResetPasswordAction, changePasswordAction, sendAccountResetCodeAction, forgotAction, googleSignInAction, resendAction, resetAction, signInAction, signUpAction, verifyAction } from "@/app/(auth)/actions";
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

/** "Continue with Google", then a divider before the email form. Secondary style: the form keeps the one primary button. */
export function GoogleSignIn() {
  return (
    <>
      <form action={googleSignInAction}>
        <GoogleButton />
      </form>
      <div className="flex items-center gap-3 text-sm text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}

function GoogleButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" variant="outline" disabled={pending} className="w-full">
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <GoogleMark />}
      {pending ? "Opening Google…" : "Continue with Google"}
    </Button>
  );
}

// Google's "G" in its brand colours (brand marks are exempt from the colour tokens).
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.26a12 12 0 0 0 0 10.78l4.01-3.1z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.26 6.61l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77z" />
    </svg>
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

/** Change password with the current one, or, if it's forgotten, with a code emailed to the account. */
export function ChangePasswordForm({ email }: { email: string }) {
  const [forgot, setForgot] = useState(false);
  return forgot ? <ResetWithCodeForm email={email} onBack={() => setForgot(false)} /> : <CurrentPasswordForm email={email} onForgot={() => setForgot(true)} />;
}

const linkButton =
  "self-start rounded text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60";

function CurrentPasswordForm({ email, onForgot }: { email: string; onForgot: () => void }) {
  const [state, action, pending] = useActionState(changePasswordAction, null);
  const [locked, setLocked] = useState(true);
  return (
    <form action={action} className="flex flex-col gap-5">
      {/* Lets password managers file the new password under the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div className="grid gap-2">
        <Label htmlFor="currentPassword">Current password</Label>
        {/* No show button, and read-only until focused so the browser can't fill in a saved password on load. */}
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          readOnly={locked}
          onFocus={() => setLocked(false)}
          aria-invalid={state?.field === "currentPassword"}
        />
        <button type="button" onClick={onForgot} className={linkButton}>
          Forgot your current password?
        </button>
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

function ResetWithCodeForm({ email, onBack }: { email: string; onBack: () => void }) {
  const [sent, send, sending] = useActionState(sendAccountResetCodeAction, null);
  const [resent, resend, resending] = useActionState(sendAccountResetCodeAction, null);
  const [state, action, pending] = useActionState(accountResetPasswordAction, null);
  const back = (
    <button type="button" onClick={onBack} className={linkButton}>
      I remember it
    </button>
  );
  if (!sent?.ok) {
    return (
      <form action={send} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          We&apos;ll email a 6-digit code to <span className="break-all text-foreground">{email}</span> to confirm it&apos;s you. Then choose a new password.
        </p>
        <Message state={sent} />
        <Button type="submit" size="lg" disabled={sending} className="w-full sm:w-auto sm:self-start">
          {sending && <Loader2 className="animate-spin" aria-hidden />}
          {sending ? "Sending…" : "Email me a code"}
        </Button>
        {back}
      </form>
    );
  }
  if (state?.ok) return <Message state={state} />;
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-5">
        <p role="status" className="text-sm text-muted-foreground">
          {sent.message}
        </p>
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
        <CodeField state={state} />
        <PasswordField state={state} isNew label="New password" />
        <Message state={state} />
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto sm:self-start">
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {pending ? "Saving…" : "Reset password"}
        </Button>
      </form>
      <form action={resend} className="flex flex-col gap-2">
        <button type="submit" disabled={resending} className={linkButton}>
          {resending ? "Sending…" : "Send a new code"}
        </button>
        <Message state={resent} />
      </form>
      {back}
    </div>
  );
}
