defmodule CuraWeb.Api.MeetingJSON do
  alias Cura.Accounts.User
  alias Cura.Meetings.Meeting

  def index(%{meetings: meetings}) do
    %{meetings: Enum.map(meetings, &data/1)}
  end

  def show(%{meeting: meeting}), do: %{meeting: data(meeting)}

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
      patient: user(meeting.patient)
    }
  end

  defp user(%User{} = user) do
    %{
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role
    }
  end

  defp user(_), do: nil
end
