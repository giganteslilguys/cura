defmodule Cura.Meetings do
  @moduledoc """
  The Meetings context.
  """

  import Ecto.Query, warn: false
  alias Cura.Repo

  alias Cura.Meetings.Meeting
  alias Cura.Meetings.TranscriptEntry

  def list_meetings do
    Repo.all(Meeting)
  end

  def list_meetings_for_user(user_id) do
    Repo.all(
      from m in Meeting,
        where: m.doctor_id == ^user_id or m.patient_id == ^user_id,
        order_by: [asc: m.date, asc: m.time],
        preload: [:doctor, patient: :patient_profile]
    )
  end

  def get_meeting_for_user!(id, user_id) do
    Repo.get_by!(Meeting, [id: id], or: [doctor_id: user_id, patient_id: user_id])
    |> Repo.preload([:doctor, patient: :patient_profile])
  end

  def get_meeting!(id) do
    case Repo.get(Meeting, id) do
      nil -> {:error, :not_found}
      meeting -> {:ok, Repo.preload(meeting, [:doctor, patient: :patient_profile])}
    end
  end

  def create_meeting(attrs \\ %{}) do
    %Meeting{}
    |> Meeting.changeset(attrs)
    |> Repo.insert()
  end

  def update_intake(%Meeting{} = meeting, attrs) do
    meeting
    |> Meeting.intake_changeset(attrs)
    |> Repo.update()
  end

  def update_notes(%Meeting{} = meeting, attrs) do
    meeting
    |> Meeting.notes_changeset(attrs)
    |> Repo.update()
  end

  def update_meeting(%Meeting{} = meeting, attrs) do
    meeting
    |> Meeting.changeset(attrs)
    |> Repo.update()
  end

  def delete_meeting(%Meeting{} = meeting) do
    Repo.delete(meeting)
  end

  def change_meeting(%Meeting{} = meeting, attrs \\ %{}) do
    Meeting.changeset(meeting, attrs)
  end

  def save_transcript_entry(meeting_id, speaker, text) do
    %TranscriptEntry{}
    |> TranscriptEntry.changeset(%{meeting_id: meeting_id, speaker: speaker, text: text})
    |> Repo.insert()
  end

  def list_transcript_entries(meeting_id) do
    Repo.all(
      from e in TranscriptEntry,
        where: e.meeting_id == ^meeting_id,
        order_by: [asc: e.inserted_at]
    )
  end
end
