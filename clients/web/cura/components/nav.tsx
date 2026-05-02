'use client';

import { Heart, LogOut } from 'lucide-react';

import type { User } from '@/lib/api/types';
import { signOut } from '@/lib/api/auth';
import { useRouter } from 'next/navigation';

export function Nav({
  user,
  token,
  right,
}: {
  user?: User;
  token?: string;
  right?: React.ReactNode;
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
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 w-3/4 max-w-2xl pointer-events-none">
      <div
        className="pointer-events-auto rounded-full px-6 py-3.5 flex items-center justify-between"
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
        <div className="flex items-center">
          <Heart className="w-5 h-5 mr-2" style={{ color: '#b5471b' }} />
          <span
            className="font-semibold tracking-tight"
            style={{ color: '#b5471b' }}
          >
            Cura
          </span>
        </div>
        {user && token ? (
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-black/40 transition-colors duration-200 hover:text-[#b5471b] hover:scale-102"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        ) : (
          right
        )}
      </div>
    </div>
  );
}
