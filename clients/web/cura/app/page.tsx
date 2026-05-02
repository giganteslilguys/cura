import { Shield, Sparkles, FileText, ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Nav } from '@/components/nav';
import { getCurrentUser } from '@/lib/auth/dal';

export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) redirect('/meetings');

  return (
    <div className="min-h-screen bg-white">
      <Nav
        right={
          <Link
            href="/login"
            className="text-sm font-medium text-black/50 hover:text-[#b5471b] transition-colors"
          >
            Sign in
          </Link>
        }
      />

      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center min-h-screen px-6 text-center overflow-hidden">
        {/* Warm radial glow */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 50% 20%, rgba(181,71,27,0.07) 0%, transparent 70%)',
          }}
        />

        <div className="relative z-10 max-w-3xl mx-auto flex flex-col items-center gap-8">
          {/* Eyebrow */}
          <div
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium tracking-widest uppercase"
            style={{
              background: 'rgba(181,71,27,0.07)',
              color: '#b5471b',
              border: '1px solid rgba(181,71,27,0.18)',
            }}
          >
            <Shield className="w-3 h-3" />
            HIPAA-Compliant · End-to-End Encrypted
          </div>

          {/* Headline */}
          <h1
            className="text-6xl sm:text-7xl font-semibold tracking-tight leading-[1.05]"
            style={{ color: '#0f0a07' }}
          >
            Healthcare,
            <br />
            <span style={{ color: '#b5471b' }}>at your fingertips.</span>
          </h1>

          {/* Subheadline */}
          <p className="text-lg text-black/45 max-w-xl leading-relaxed">
            Secure video consultations between doctors and patients — with real‑time AI clinical support built right in.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center gap-3 mt-2">
            <Link
              href="/login"
              className="flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              style={{ background: '#b5471b' }}
            >
              I&apos;m a patient
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/login"
              className="flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-medium transition-colors"
              style={{
                background: 'rgba(0,0,0,0.04)',
                color: '#0f0a07',
                border: '1px solid rgba(0,0,0,0.08)',
              }}
            >
              I&apos;m a doctor
              <ArrowRight className="w-4 h-4 opacity-50" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-black/[0.06] px-6 py-8 max-w-5xl mx-auto flex items-center justify-between">
        <Image src="/cura.svg" alt="Cura" width={54} height={14} />
        <p className="text-xs text-black/25">
          © {new Date().getFullYear()} Cura. All rights reserved.
        </p>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div
      className="rounded-2xl p-6 flex flex-col gap-4"
      style={{
        background: 'rgba(0,0,0,0.02)',
        border: '1px solid rgba(0,0,0,0.06)',
      }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center"
        style={{
          background: 'rgba(181,71,27,0.08)',
          color: '#b5471b',
        }}
      >
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-black mb-1.5">{title}</h3>
        <p className="text-xs text-black/40 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
