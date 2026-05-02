defmodule CuraWeb.Api.DocumentController do
  use CuraWeb, :controller

  alias Cura.Documents

  action_fallback CuraWeb.FallbackController

  def index(conn, %{"patient_id" => patient_id}) do
    documents = Documents.list_documents(patient_id)
    render(conn, :index, documents: documents)
  end

  def create(conn, %{"patient_id" => patient_id, "file" => %Plug.Upload{} = upload}) do
    user = conn.assigns.current_user

    with {:ok, doc} <- Documents.save_document(patient_id, user.id, upload) do
      conn
      |> put_status(:created)
      |> render(:show, document: doc)
    end
  end

  def download(conn, %{"id" => id}) do
    with {:ok, doc} <- Documents.get_document(id) do
      path = Documents.full_path(doc)

      conn
      |> put_resp_content_type(doc.content_type)
      |> put_resp_header(
        "content-disposition",
        ~s(attachment; filename="#{doc.filename}")
      )
      |> send_file(200, path)
    end
  end

  def delete(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    with {:ok, doc} <- Documents.get_document(id),
         true <- doc.patient_id == user.id or doc.uploaded_by_id == user.id or user.role == :doctor do
      {:ok, _} = Documents.delete_document(doc)
      send_resp(conn, :no_content, "")
    else
      false -> {:error, :unauthorized}
      error -> error
    end
  end
end
