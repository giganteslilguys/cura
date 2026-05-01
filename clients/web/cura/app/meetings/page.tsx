import Link from "next/link";
import { redirect } from "next/navigation";

import { listMeetings } from "@/lib/api/meetings";
import { getCurrentUser } from "@/lib/auth/dal";
import { getSessionToken } from "@/lib/auth/session";

export default async function MeetingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const token = await getSessionToken();
  if (!token) redirect("/sign-in");

  const { meetings } = await listMeetings(token);

  return (
    <main className="flex flex-1 flex-col w-full max-w-3xl mx-auto p-8 gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Meetings</h1>
        <span className="text-sm text-zinc-500">{user.email}</span>
      </header>

      {meetings.length === 0 ? (
        <p className="text-zinc-500">No meetings yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {meetings.map((m) => (
            <li
              key={m.id}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 flex items-center justify-between"
            >
              <div className="flex flex-col">
                <span className="font-medium">{m.title}</span>
                <span className="text-sm text-zinc-500">
                  {m.date} · {m.time} · {m.duration} min
                </span>
              </div>
              <Link
                href={`/meetings/${m.id}`}
                className="px-4 py-2 rounded-md bg-foreground text-background text-sm font-medium"
              >
                Join
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
