defmodule Cura.Repo.Migrations.CreatePatientProfiles do
  use Ecto.Migration

  def change do
    create table(:patient_profiles, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false

      add :sex, :string
      add :date_of_birth, :date
      add :weight_kg, :float
      add :height_cm, :float

      add :medications, :jsonb, null: false, default: "[]"
      add :allergies, :jsonb, null: false, default: "[]"
      add :conditions, {:array, :string}, null: false, default: []

      timestamps()
    end

    create unique_index(:patient_profiles, [:user_id])
  end
end
