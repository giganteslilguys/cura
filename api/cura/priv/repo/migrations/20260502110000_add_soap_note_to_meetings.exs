defmodule Cura.Repo.Migrations.AddSoapNoteToMeetings do
  use Ecto.Migration

  def change do
    alter table(:meetings) do
      add :soap_note, :map
      add :soap_note_submitted, :boolean, default: false, null: false
    end
  end
end
