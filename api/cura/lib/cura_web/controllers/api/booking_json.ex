defmodule CuraWeb.Api.BookingJSON do
  alias Cura.Accounts.User
  alias Cura.Meetings.Meeting

  def doctors(%{doctors: doctors}), do: %{doctors: Enum.map(doctors, &doctor_data/1)}

  def slots(%{slots: slots}), do: %{slots: Enum.map(slots, &slot_data/1)}

  def any_slots(%{slots: slots}), do: %{slots: Enum.map(slots, &any_slot_data/1)}

  def meeting(%{meeting: meeting}), do: %{meeting: meeting_data(meeting)}

  defp doctor_data(%User{} = u) do
    %{id: u.id, first_name: u.first_name, last_name: u.last_name, email: u.email}
  end

  defp slot_data(%{time: time, duration: duration}) do
    %{time: Time.to_string(time), duration: duration}
  end

  defp any_slot_data(%{time: time, duration: duration, doctor: doctor}) do
    %{
      time: Time.to_string(time),
      duration: duration,
      doctor_id: doctor.id,
      doctor_first_name: doctor.first_name,
      doctor_last_name: doctor.last_name
    }
  end

  defp meeting_data(%Meeting{} = m) do
    %{
      id: m.id,
      title: m.title,
      date: Date.to_string(m.date),
      time: Time.to_string(m.time),
      duration: m.duration,
      status: m.status,
      timezone: m.timezone
    }
  end
end
