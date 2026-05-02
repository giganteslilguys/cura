defmodule Cura.Meetings.TranscriptEntry do
  use Cura.Schema
  alias Cura.Meetings.Meeting

  schema "transcript_entries" do
    belongs_to :meeting, Meeting
    field :speaker, Ecto.Enum, values: [:doctor, :patient]
    field :text, :string

    timestamps(updated_at: false)
  end

  def changeset(entry, attrs) do
    entry
    |> cast(attrs, [:meeting_id, :speaker, :text])
    |> validate_required([:meeting_id, :speaker, :text])
  end
end
