defmodule Cura.Repo.Migrations.AddReminderFlagsToMeetings do
  use Ecto.Migration

  def change do
    alter table(:meetings) do
      add :reminder_24h_sent, :boolean, default: false, null: false
      add :reminder_1h_sent,  :boolean, default: false, null: false
    end
  end
end
