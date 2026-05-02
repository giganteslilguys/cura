'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { Mail, Lock, LogIn } from 'lucide-react';

import { signInAction, type AuthActionResult } from '@/lib/auth/actions';

export function SignInForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    AuthActionResult | undefined,
    FormData
  >(signInAction, undefined);

  useEffect(() => {
    if (state?.ok) router.replace('/meetings');
  }, [state, router]);

  return (
    <form action={formAction} className="flex flex-col gap-7">
      <label className="flex flex-col gap-2.5">
        <span className="text-xs font-medium text-black/40 uppercase tracking-widest flex items-center gap-1.5">
          <Mail className="w-3.5 h-3.5" /> Email
        </span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full border-b border-black/12 py-2.5 bg-transparent text-black outline-none focus:border-[#b5471b] transition-colors placeholder:text-black/20"
        />
      </label>

      <label className="flex flex-col gap-2.5">
        <span className="text-xs font-medium text-black/40 uppercase tracking-widest flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" /> Palavra-passe
        </span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full border-b border-black/12 py-2.5 bg-transparent text-black outline-none focus:border-[#b5471b] transition-colors"
        />
      </label>

      {state && !state.ok && (
        <p className="text-sm text-[#b5471b]">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-[#b5471b] text-white py-3 font-medium hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
      >
        <LogIn className="w-4 h-4" />
        {pending ? 'A entrar…' : 'Entrar'}
      </button>
    </form>
  );
}
