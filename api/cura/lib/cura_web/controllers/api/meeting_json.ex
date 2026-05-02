defmodule CuraWeb.Api.MeetingJSON do
  alias Cura.Accounts.{PatientProfile, User}
  alias Cura.Meetings.Meeting

  def index(%{meetings: meetings}) do
    %{meetings: Enum.map(meetings, &data/1)}
  end

  def show(%{meeting: meeting}), do: %{meeting: data(meeting)}

  def transcript(%{entries: entries}) do
    %{transcript: Enum.map(entries, fn e ->
      %{
        id: e.id,
        speaker: e.speaker,
        text: e.text,
        timestamp: e.inserted_at
      }
    end)}
  end

  defp data(%Meeting{} = meeting) do
    %{
      id: meeting.id,
      title: meeting.title,
      date: meeting.date,
      time: meeting.time,
      duration: meeting.duration,
      notes: meeting.notes,
      timezone: meeting.timezone,
      status: meeting.status,
      doctor: user(meeting.doctor),
      patient: user(meeting.patient),
      patient_intake: meeting.patient_intake,
      soap_note: meeting.soap_note,
      soap_note_submitted: meeting.soap_note_submitted,
      kind: meeting.kind
    }
  end

  defp user(%User{} = user) do
    %{
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
      patient_profile: profile(user.patient_profile)
    }
  end

  defp user(_), do: nil

  defp profile(%PatientProfile{} = profile) do
    %{
      sex: profile.sex,
      date_of_birth: profile.date_of_birth,
      weight_kg: profile.weight_kg,
      height_cm: profile.height_cm,
      bmi: PatientProfile.bmi(profile),
      medications:
        Enum.map(profile.medications, fn m ->
          %{name: m.name, dose: m.dose, frequency: m.frequency}
        end),
      allergies:
        Enum.map(profile.allergies, fn a ->
          %{substance: a.substance, severity: a.severity}
        end),
      conditions: profile.conditions
    }
  end

  defp profile(_), do: nil
end
