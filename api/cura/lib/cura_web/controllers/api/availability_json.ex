defmodule CuraWeb.Api.AvailabilityJSON do
  alias Cura.Meetings.DoctorAvailability

  def index(%{availability: list}), do: %{availability: Enum.map(list, &data/1)}
  def show(%{availability: avail}), do: %{availability: data(avail)}

  defp data(%DoctorAvailability{} = a) do
    %{
      id: a.id,
      day_of_week: a.day_of_week,
      start_time: Time.to_string(a.start_time),
      end_time: Time.to_string(a.end_time),
      slot_duration: a.slot_duration
    }
  end
end
