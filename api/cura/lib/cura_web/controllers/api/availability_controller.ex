defmodule CuraWeb.Api.AvailabilityController do
  use CuraWeb, :controller

  alias Cura.Meetings

  action_fallback CuraWeb.FallbackController

  def index(conn, _params) do
    user = conn.assigns.current_user

    with true <- user.role == :doctor do
      availability = Meetings.list_availability(user.id)
      render(conn, :index, availability: availability)
    else
      false -> {:error, :unauthorized}
    end
  end

  def create(conn, params) do
    user = conn.assigns.current_user

    with true <- user.role == :doctor,
         {:ok, avail} <- Meetings.create_availability(user.id, params) do
      conn
      |> put_status(:created)
      |> render(:show, availability: avail)
    else
      false -> {:error, :unauthorized}
      error -> error
    end
  end

  def delete(conn, %{"id" => id}) do
    user = conn.assigns.current_user

    with true <- user.role == :doctor,
         {:ok, _} <- Meetings.delete_availability(id, user.id) do
      send_resp(conn, :no_content, "")
    else
      false -> {:error, :unauthorized}
      error -> error
    end
  end
end
