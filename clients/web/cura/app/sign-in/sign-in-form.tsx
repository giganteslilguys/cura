"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { signInAction, type AuthActionResult } from "@/lib/auth/actions";

export function SignInForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    AuthActionResult | undefined,
    FormData
  >(signInAction, undefined);

  useEffect(() => {
    if (state?.ok) router.replace("/meetings");
  }, [state, router]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-3 py-2"
        />
      </label>

      {state && !state.ok && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-foreground text-background py-2 font-medium disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
