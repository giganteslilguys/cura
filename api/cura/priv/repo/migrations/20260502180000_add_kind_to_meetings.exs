defmodule Cura.Repo.Migrations.AddKindToMeetings do
  use Ecto.Migration

  def change do
    alter table(:meetings) do
      add :kind, :string, default: "video", null: false
    end
  end
end
