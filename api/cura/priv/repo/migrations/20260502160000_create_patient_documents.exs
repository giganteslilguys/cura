defmodule Cura.Repo.Migrations.CreatePatientDocuments do
  use Ecto.Migration

  def change do
    create table(:patient_documents, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :patient_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false

      add :uploaded_by_id, references(:users, type: :binary_id, on_delete: :delete_all),
        null: false

      add :filename, :string, null: false
      add :content_type, :string, null: false
      add :size, :integer, null: false
      add :storage_path, :string, null: false

      timestamps(updated_at: false)
    end

    create index(:patient_documents, [:patient_id])
  end
end
