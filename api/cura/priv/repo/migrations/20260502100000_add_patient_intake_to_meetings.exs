defmodule Cura.Repo.Migrations.AddPatientIntakeToMeetings do
  use Ecto.Migration

  def change do
    alter table(:meetings) do
      add :patient_intake, :map
    end
  end
end
