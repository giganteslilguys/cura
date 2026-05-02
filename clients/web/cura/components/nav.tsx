'use client';

import Image from 'next/image';
import { LogOut } from 'lucide-react';
import type { User } from '@/lib/api/types';
import { signOut } from '@/lib/api/auth';
import { useRouter } from 'next/navigation';

export function Nav({
  user,
  token,
  right,
  center,
  wide,
}: {
  user?: User;
  token?: string;
  right?: React.ReactNode;
  center?: React.ReactNode;
  wide?: boolean;
}) {
  const router = useRouter();

  const handleLogout = async () => {
    if (!token) return;
    try {
      await signOut(token);
      router.push('/sign-in');
    } catch (error) {
      console.error('Logout failed', error);
    }
  };

  return (
    <div
      className={`fixed top-5 left-1/2 mb-4 -translate-x-1/2 z-50 pointer-events-none ${wide ? 'w-[calc(100%-3rem)]' : 'w-3/4 max-w-2xl'}`}
    >
      <div
        className="pointer-events-auto rounded-full px-6 py-3.5 min-h-14.5 flex items-center justify-between gap-4"
        style={{
          background:
            'linear-gradient(160deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.10) 100%)',
          backdropFilter: 'blur(52px) saturate(180%) brightness(1.05)',
          WebkitBackdropFilter: 'blur(52px) saturate(180%) brightness(1.05)',
          border: '1px solid rgba(255,255,255,0.55)',
          boxShadow: [
            'inset 0 1.5px 0 rgba(255,255,255,0.90)',
            'inset 0 -1px 0 rgba(0,0,0,0.04)',
            'inset 1px 0 0 rgba(255,255,255,0.30)',
            '0 12px 48px rgba(0,0,0,0.09)',
            '0 2px 8px rgba(0,0,0,0.05)',
          ].join(', '),
        }}
      >
        <Image
          src="/cura.svg"
          alt="Cura"
          width={54}
          height={14}
          priority
          className="shrink-0"
        />
        {center && (
          <div className="flex-1 flex items-center justify-center min-w-0">
            {center}
          </div>
        )}
        {user && token ? (
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-black/40 transition-colors duration-200 hover:text-[#b5471b] hover:scale-102"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        ) : (
          right
        )}
      </div>
    </div>
  );
}
