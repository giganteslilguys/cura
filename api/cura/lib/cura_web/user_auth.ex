defmodule CuraWeb.UserAuth do
  @moduledoc """
  Plug for authenticating JSON API requests using a Bearer token.
  """

  import Plug.Conn

  alias Cura.Accounts

  @doc """
  Fetches the user from the database based on the Bearer token in the
  Authorization header. Halts with 401 if the token is missing or invalid.
  """
  def fetch_api_user(conn, _opts) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         {:ok, user} <- Accounts.fetch_user_by_session_token(token) do
      conn
      |> assign(:current_user, user)
      |> assign(:current_token, token)
    else
      _ ->
        conn
        |> put_resp_content_type("application/json")
        |> send_resp(:unauthorized, Jason.encode!(%{error: "unauthorized"}))
        |> halt()
    end
  end
end
