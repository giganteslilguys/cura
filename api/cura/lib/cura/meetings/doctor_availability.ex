defmodule Cura.Meetings.DoctorAvailability do
  use Cura.Schema
  alias Cura.Accounts.User

  schema "doctor_availability" do
    belongs_to :doctor, User

    # ISO week day: 1=Monday … 7=Sunday
    field :day_of_week, :integer
    field :start_time, :time
    field :end_time, :time
    field :slot_duration, :integer, default: 30

    timestamps(updated_at: false)
  end

  def changeset(avail, attrs) do
    avail
    |> cast(attrs, [:doctor_id, :day_of_week, :start_time, :end_time, :slot_duration])
    |> validate_required([:doctor_id, :day_of_week, :start_time, :end_time, :slot_duration])
    |> validate_inclusion(:day_of_week, 1..7)
    |> validate_inclusion(:slot_duration, [15, 30, 45, 60, 90, 120],
      message: "must be 15, 30, 45, 60, 90, or 120 minutes"
    )
    |> validate_time_range()
  end

  defp validate_time_range(changeset) do
    start_time = get_field(changeset, :start_time)
    end_time = get_field(changeset, :end_time)

    if start_time && end_time && Time.compare(start_time, end_time) != :lt do
      add_error(changeset, :end_time, "must be after start time")
    else
      changeset
    end
  end
end
