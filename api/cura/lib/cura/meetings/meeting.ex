defmodule Cura.Meetings.Meeting do
  @moduledoc """
    A Job offer Meeting with comprehensive validation and business logic.
  """
  use Cura.Schema
  alias Cura.Accounts.User

  @required_fields ~w(title date time duration doctor_id patient_id)a
  @optional_fields ~w(notes status timezone)a

  schema "meetings" do
    belongs_to :doctor, User
    belongs_to :patient, User

    field :title, :string
    field :date, :date
    field :time, :time
    field :duration, :integer
    field :notes, :string
    field :timezone, :string, default: "UTC"

    field :status, Ecto.Enum,
      values: [:scheduled, :completed, :canceled, :rejected],
      default: :scheduled

    timestamps()
  end


  def changeset(meeting, attrs) do
    meeting
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
    |> validate_meeting_title()
    |> validate_future_date_time()
    |> validate_duration()
    |> validate_notes_length()
    |> unique_constraint([:doctor_id, :date, :time],
      name: :meetings_unique_datetime_per_doctor,
      message: "A meeting is already scheduled for this doctor at this date and time"
    )
  end

  defp validate_meeting_title(changeset) do
    changeset
    |> validate_length(:title,
      min: 3,
      max: 100,
      message: "Meeting title must be between 3 and 100 characters"
    )
    |> validate_format(:title, ~r/^[a-zA-Z0-9\s\-_,.:()]+$/,
      message: "Meeting title contains invalid characters"
    )
  end

  defp validate_future_date_time(changeset) do
    date = get_field(changeset, :date)
    time = get_field(changeset, :time)
    timezone = get_field(changeset, :timezone) || "UTC"

    case {date, time} do
      {%Date{} = meeting_date, %Time{} = meeting_time} ->
        meeting_datetime = DateTime.new!(meeting_date, meeting_time, timezone)
        current_datetime = DateTime.utc_now()

        if DateTime.compare(meeting_datetime, current_datetime) == :lt do
          changeset
          |> add_error(:date, "Meeting cannot be scheduled in the past")
          |> add_error(:time, "Meeting time must be in the future")
        else
          max_future_date = DateTime.add(current_datetime, 365, :day)

          if DateTime.compare(meeting_datetime, max_future_date) == :gt do
            add_error(changeset, :date, "Meeting cannot be scheduled more than 1 year in advance")
          else
            changeset
          end
        end

      _ ->
        changeset
    end
  end

  defp validate_duration(changeset) do
    changeset
    |> validate_inclusion(:duration, [15, 30, 45, 60, 90, 120, 180, 240],
      message: "Duration must be 15, 30, 45, 60, 90, 120, 180, or 240 minutes"
    )
  end

  defp validate_notes_length(changeset) do
    changeset
    |> validate_length(:notes,
      max: 1000,
      message: "Meeting notes cannot exceed 1000 characters"
    )
  end
end
