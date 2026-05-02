defmodule Cura.Documents.PatientDocument do
  use Cura.Schema
  alias Cura.Accounts.User

  schema "patient_documents" do
    belongs_to :patient, User
    belongs_to :uploaded_by, User

    field :filename, :string
    field :content_type, :string
    field :size, :integer
    field :storage_path, :string

    timestamps(updated_at: false)
  end

  def changeset(doc, attrs) do
    doc
    |> cast(attrs, [:patient_id, :uploaded_by_id, :filename, :content_type, :size, :storage_path])
    |> validate_required([
      :patient_id,
      :uploaded_by_id,
      :filename,
      :content_type,
      :size,
      :storage_path
    ])
  end
end
