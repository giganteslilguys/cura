import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/dal";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? "/meetings" : "/sign-in");
}
