defmodule Cura.Repo.Migrations.CreateMeetings do
  use Ecto.Migration

  def change do
    create table(:meetings, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :title, :string, null: false
      add :date, :date, null: false
      add :time, :time, null: false
      add :duration, :integer, null: false
      add :notes, :string
      add :timezone, :string, default: "UTC"
      add :status, :string, default: "scheduled", null: false

      add :doctor_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :patient_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false

      timestamps()
    end

    create unique_index(:meetings, [:doctor_id, :date, :time],
             name: :meetings_unique_datetime_per_doctor
           )
  end
end
