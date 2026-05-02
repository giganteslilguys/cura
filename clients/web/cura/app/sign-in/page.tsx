import { Nav } from "@/components/nav";
import { SignInForm } from "./sign-in-form";
import { getCurrentUser } from "@/lib/auth/dal";
import { redirect } from "next/navigation";

export default async function SignInPage() {
  const user = await getCurrentUser();
  if (user) redirect("/meetings");

  return (
    <div className="min-h-screen" style={{ background: '#ffffff' }}>
      <Nav />
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm flex flex-col gap-10">
          <div>
            <h1 className="text-2xl font-semibold text-black">Sign in</h1>
            <p className="text-sm text-black/40 mt-1">Welcome back to cura</p>
          </div>
          <SignInForm />
        </div>
      </main>
    </div>
  );
}
