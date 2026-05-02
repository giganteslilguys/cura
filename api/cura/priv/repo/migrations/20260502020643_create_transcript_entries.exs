defmodule Cura.Repo.Migrations.CreateTranscriptEntries do
  use Ecto.Migration

  def change do
    create table(:transcript_entries, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :meeting_id, references(:meetings, type: :binary_id, on_delete: :delete_all), null: false
      add :speaker, :string, null: false
      add :text, :text, null: false

      timestamps(updated_at: false)
    end

    create index(:transcript_entries, [:meeting_id])
  end
end
