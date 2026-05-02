defmodule CuraWeb.Api.DocumentJSON do
  alias Cura.Documents.PatientDocument

  def index(%{documents: docs}), do: %{documents: Enum.map(docs, &data/1)}
  def show(%{document: doc}), do: %{document: data(doc)}

  defp data(%PatientDocument{} = d) do
    %{
      id: d.id,
      filename: d.filename,
      content_type: d.content_type,
      size: d.size,
      inserted_at: d.inserted_at
    }
  end
end
