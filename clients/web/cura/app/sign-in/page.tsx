import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/dal";

import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  const user = await getCurrentUser();
  if (user) redirect("/meetings");

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <SignInForm />
      </div>
    </main>
  );
}
