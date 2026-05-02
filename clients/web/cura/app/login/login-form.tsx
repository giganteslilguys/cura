'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { Mail, Lock, ArrowRight } from 'lucide-react';

import { signInAction, type AuthActionResult } from '@/lib/auth/actions';

export function LoginForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    AuthActionResult | undefined,
    FormData
  >(signInAction, undefined);

  useEffect(() => {
    if (state?.ok) router.replace('/meetings');
  }, [state, router]);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <label className="flex flex-col gap-2.5">
        <span className="text-xs font-medium text-black/35 uppercase tracking-widest flex items-center gap-1.5">
          <Mail className="w-3.5 h-3.5" /> Email
        </span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="w-full border-b border-black/10 py-2.5 bg-transparent text-black outline-none focus:border-[#b5471b] transition-colors placeholder:text-black/20 text-sm"
        />
      </label>

      <label className="flex flex-col gap-2.5">
        <span className="text-xs font-medium text-black/35 uppercase tracking-widest flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" /> Password
        </span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className="w-full border-b border-black/10 py-2.5 bg-transparent text-black outline-none focus:border-[#b5471b] transition-colors placeholder:text-black/20 text-sm"
        />
      </label>

      {state && !state.ok && (
        <p className="text-sm text-[#b5471b]">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 w-full rounded-full py-3.5 text-sm font-medium text-white flex items-center justify-center gap-2 transition-opacity hover:opacity-90 disabled:opacity-40"
        style={{ background: '#b5471b' }}
      >
        {pending ? 'Signing in…' : 'Continue'}
        {!pending && <ArrowRight className="w-4 h-4" />}
      </button>
    </form>
  );
}
