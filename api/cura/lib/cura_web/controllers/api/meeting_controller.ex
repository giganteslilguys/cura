defmodule CuraWeb.Api.MeetingController do
  use CuraWeb, :controller

  alias Cura.Meetings

  action_fallback CuraWeb.FallbackController

  def index(conn, _params) do
    user = conn.assigns.current_user
    meetings = Meetings.list_meetings_for_user(user.id)
    render(conn, :index, meetings: meetings)
  end

  def show(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    with {:ok, meeting} <- Meetings.get_meeting!(id),
         true <- meeting.doctor_id == user.id or meeting.patient_id == user.id do
      render(conn, :show, meeting: meeting)
    else
      false -> {:error, :unauthorized}
      error -> error
    end
  end

  def update_notes(conn, %{"id" => id} = params) do
    user = conn.assigns.current_user

    with {:ok, meeting} <- Meetings.get_meeting!(id),
         true <- meeting.doctor_id == user.id,
         {:ok, updated} <- Meetings.update_notes(meeting, %{notes: params["notes"]}) do
      render(conn, :show, meeting: updated)
    else
      false -> {:error, :unauthorized}
      error -> error
    end
  end

  def intake(conn, %{"id" => id} = params) do
    user = conn.assigns.current_user

    with {:ok, meeting} <- Meetings.get_meeting!(id),
         true <- meeting.patient_id == user.id,
         {:ok, updated} <- Meetings.update_intake(meeting, params) do
      render(conn, :show, meeting: updated)
    else
      false -> {:error, :unauthorized}
      error -> error
    end
  end

  def soap_note(conn, %{"id" => id} = params) do
    user = conn.assigns.current_user

    with {:ok, meeting} <- Meetings.get_meeting!(id),
         :ok <- authorize_doctor(meeting, user.id),
         :ok <- check_not_submitted(meeting),
         {:ok, updated} <- Meetings.update_soap_note(meeting, params) do
      render(conn, :show, meeting: updated)
    end
  end

  def transcript(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    with {:ok, meeting} <- Meetings.get_meeting!(id),
         :ok <- authorize_participant(meeting, user.id) do
      entries = Meetings.list_transcript_entries(meeting.id)
      render(conn, :transcript, entries: entries)
    end
  end

  defp authorize_doctor(meeting, user_id) do
    if meeting.doctor_id == user_id, do: :ok, else: {:error, :unauthorized}
  end

  defp authorize_participant(meeting, user_id) do
    if meeting.doctor_id == user_id or meeting.patient_id == user_id,
      do: :ok,
      else: {:error, :unauthorized}
  end

  defp check_not_submitted(meeting) do
    if meeting.soap_note_submitted, do: {:error, :unprocessable_entity}, else: :ok
  end
end
