import { notFound, redirect } from "next/navigation";

import { ApiError } from "@/lib/api/errors";
import { getMeeting } from "@/lib/api/meetings";
import { getCurrentUser } from "@/lib/auth/dal";
import { getSessionToken } from "@/lib/auth/session";

import { MeetingRoom } from "./meeting-room";

type Params = { id: string };

export default async function MeetingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const token = await getSessionToken();
  if (!token) redirect("/sign-in");

  let meeting;
  try {
    const result = await getMeeting(id, token);
    meeting = result.meeting;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    if (error instanceof ApiError && error.status === 401) redirect("/sign-in");
    throw error;
  }

  return (
    <MeetingRoom
      meeting={meeting}
      currentUser={user}
      token={token}
    />
  );
}
