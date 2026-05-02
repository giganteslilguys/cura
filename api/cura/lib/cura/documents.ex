defmodule Cura.Documents do
  import Ecto.Query, warn: false
  alias Cura.Repo
  alias Cura.Documents.PatientDocument

  @uploads_dir Application.compile_env(:cura, :uploads_dir, "priv/uploads")

  def uploads_dir do
    Path.join(Application.app_dir(:cura), @uploads_dir)
  end

  def list_documents(patient_id) do
    Repo.all(
      from d in PatientDocument,
        where: d.patient_id == ^patient_id,
        order_by: [desc: d.inserted_at]
    )
  end

  def get_document(id) do
    case Repo.get(PatientDocument, id) do
      nil -> {:error, :not_found}
      doc -> {:ok, doc}
    end
  end

  def save_document(patient_id, uploaded_by_id, %Plug.Upload{} = upload) do
    ext = upload.filename |> Path.extname() |> String.downcase()
    storage_name = "#{Ecto.UUID.generate()}#{ext}"
    dest = Path.join(uploads_dir(), storage_name)

    File.mkdir_p!(uploads_dir())
    File.copy!(upload.path, dest)

    %{size: size} = File.stat!(dest)

    %PatientDocument{}
    |> PatientDocument.changeset(%{
      patient_id: patient_id,
      uploaded_by_id: uploaded_by_id,
      filename: upload.filename,
      content_type: upload.content_type || "application/octet-stream",
      size: size,
      storage_path: storage_name
    })
    |> Repo.insert()
  end

  def delete_document(%PatientDocument{} = doc) do
    path = Path.join(uploads_dir(), doc.storage_path)
    if File.exists?(path), do: File.rm!(path)
    Repo.delete(doc)
  end

  def full_path(%PatientDocument{} = doc) do
    Path.join(uploads_dir(), doc.storage_path)
  end
end
