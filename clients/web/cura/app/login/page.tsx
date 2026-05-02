import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth/dal';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect('/meetings');

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{
        background:
          'radial-gradient(ellipse 90% 70% at 50% 0%, rgba(181,71,27,0.06) 0%, transparent 65%), #ffffff',
      }}
    >
      <div className="w-full max-w-sm flex flex-col gap-10">
        <div className="flex flex-col items-center gap-3">
          <Image src="/cura.svg" alt="Cura" width={72} height={19} priority />
          <div className="text-center">
            <h1 className="text-xl font-semibold text-black tracking-tight">
              Bem-vindo/a de volta
            </h1>
            <p className="text-sm text-black/40 mt-0.5">
              Entrar na sua conta Cura
            </p>
          </div>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl px-8 py-8"
          style={{
            background: '#ffffff',
            border: '1px solid rgba(0,0,0,0.07)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.05), 0 1px 4px rgba(0,0,0,0.04)',
          }}
        >
          <LoginForm />
        </div>

        {/* Back to home */}
        <p className="text-center text-xs text-black/30">
          <Link href="/" className="hover:text-[#b5471b] transition-colors">
            ← Voltar à página inicial
          </Link>
        </p>
      </div>
    </div>
  );
}
