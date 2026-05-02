defmodule Cura.Meetings.Meeting do
  @moduledoc """
    A Job offer Meeting with comprehensive validation and business logic.
  """
  use Cura.Schema
  alias Cura.Accounts.User

  @required_fields ~w(title date time duration doctor_id patient_id)a
  @optional_fields ~w(notes status timezone kind)a
  @intake_fields ~w(reason symptoms notes)a

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

    field :kind, Ecto.Enum, values: [:video, :on_site], default: :video

    field :patient_intake, :map
    field :soap_note, :map
    field :soap_note_submitted, :boolean, default: false

    field :reminder_24h_sent, :boolean, default: false
    field :reminder_1h_sent, :boolean, default: false

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
        meeting_naive = NaiveDateTime.new!(meeting_date, meeting_time)
        current_naive = NaiveDateTime.utc_now()

        grace = NaiveDateTime.add(current_naive, -60, :second)

        if NaiveDateTime.compare(meeting_naive, grace) == :lt do
          changeset
          |> add_error(:date, "Meeting cannot be scheduled in the past")
          |> add_error(:time, "Meeting time must be in the future")
        else
          max_future = NaiveDateTime.add(current_naive, 365, :day)

          if NaiveDateTime.compare(meeting_naive, max_future) == :gt do
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

  def notes_changeset(meeting, attrs) do
    meeting
    |> cast(attrs, [:notes])
    |> validate_notes_length()
  end

  def soap_note_changeset(meeting, attrs) do
    note = attrs["soap_note"] || attrs[:soap_note] || %{}
    submit = attrs["submit"] == true || attrs[:submit] == true

    update_attrs = %{soap_note: note}

    final_attrs =
      if submit, do: Map.put(update_attrs, :soap_note_submitted, true), else: update_attrs

    cast(meeting, final_attrs, [:soap_note, :soap_note_submitted])
  end

  def reschedule_changeset(meeting, attrs) do
    meeting
    |> cast(attrs, [:doctor_id, :date, :time])
    |> validate_required([:doctor_id, :date, :time])
    |> validate_date_not_before_original(meeting.date)
    |> validate_future_date_time()
    |> put_change(:reminder_24h_sent, false)
    |> put_change(:reminder_1h_sent, false)
    |> unique_constraint([:doctor_id, :date, :time],
      name: :meetings_unique_datetime_per_doctor,
      message: "A meeting is already scheduled for this doctor at this date and time"
    )
  end

  defp validate_date_not_before_original(changeset, original_date) do
    case get_field(changeset, :date) do
      %Date{} = new_date when not is_nil(original_date) ->
        if Date.compare(new_date, original_date) == :lt do
          add_error(changeset, :date, "cannot be earlier than the original appointment date")
        else
          changeset
        end

      _ ->
        changeset
    end
  end

  def intake_changeset(meeting, attrs) do
    intake = attrs["patient_intake"] || attrs[:patient_intake] || %{}

    validated =
      {%{}, Enum.map(@intake_fields, &{&1, :string}) |> Map.new()}
      |> Ecto.Changeset.cast(intake, @intake_fields)
      |> Ecto.Changeset.validate_required([:reason], message: "Reason for visit is required")
      |> Ecto.Changeset.validate_length(:reason, max: 500)
      |> Ecto.Changeset.validate_length(:symptoms, max: 1000)
      |> Ecto.Changeset.validate_length(:notes, max: 1000)

    if validated.valid? do
      meeting
      |> cast(%{patient_intake: Ecto.Changeset.apply_changes(validated)}, [:patient_intake])
    else
      Ecto.Changeset.add_error(
        cast(meeting, %{}, []),
        :patient_intake,
        "is invalid",
        errors: validated.errors
      )
    end
  end
end
