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
  mobileCenter,
  wide,
}: {
  user?: User;
  token?: string;
  right?: React.ReactNode;
  center?: React.ReactNode;
  mobileCenter?: React.ReactNode;
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
      className={`absolute bottom-[calc(env(safe-area-inset-bottom,0px)+2.5rem)] left-1/2 -translate-x-1/2 z-50 pointer-events-none md:fixed md:top-5 md:bottom-auto ${wide ? 'w-[calc(100%-3rem)]' : 'w-3/4 max-w-2xl'}`}
    >
      <div
        className="pointer-events-auto rounded-full px-6 py-3.5 min-h-14.5 flex items-center justify-between gap-4"
        style={{
          background:
            'linear-gradient(160deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.10) 100%)',
          backdropFilter: 'blur(52px) saturate(180%) brightness(1.05)',
          WebkitBackdropFilter: 'blur(52px) saturate(180%) brightness(1.05)',
          border: '2px solid rgba(255,255,255,.3)',
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.85), 0 6px 14px rgba(0,0,0,0.08)',
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
        {mobileCenter && (
          <div className="flex md:hidden flex-1 items-center justify-center gap-2">
            {mobileCenter}
          </div>
        )}
        {center && (
          <div className="hidden md:flex flex-1 items-center justify-center min-w-0">
            {center}
          </div>
        )}
        <div>
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
    </div>
  );
}
