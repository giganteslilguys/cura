defmodule Cura.Repo.Migrations.CreateDoctorAvailability do
  use Ecto.Migration

  def change do
    create table(:doctor_availability, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :doctor_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false
      add :day_of_week, :integer, null: false
      add :start_time, :time, null: false
      add :end_time, :time, null: false
      add :slot_duration, :integer, null: false, default: 30

      timestamps(updated_at: false)
    end

    create index(:doctor_availability, [:doctor_id])
    create index(:doctor_availability, [:doctor_id, :day_of_week])
  end
end
