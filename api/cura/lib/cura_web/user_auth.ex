defmodule CuraWeb.UserAuth do
  @moduledoc """
  Plug for authenticating JSON API requests using a Bearer token.
  """

  import Plug.Conn
  require Logger

  alias Cura.Accounts
  @max_age 60 * 60 * 24 * 60
  @remember_me_cookie "_cura_user_remember_me"
  @remember_me_options [sign: true, max_age: @max_age, same_site: "Lax"]


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

  def fetch_current_user(conn, _opts) do
    {user_token, conn} = ensure_user_token(conn)

    user =
      with token when is_binary(token) <- user_token,
           {:ok, user} <- Accounts.fetch_user_by_session_token(token) do
        user
      else
        _ -> nil
      end

    conn
    |> assign(:current_user, user)
    |> assign(:is_authenticated?, !!user)
  end

  def on_mount(:fetch_current_user, _params, session, socket) do
    {:cont, assign_current_user(socket, session)}
  end

  def on_mount(:require_authenticated_user, _params, session, socket) do
    socket = assign_current_user(socket, session)

    if socket.assigns.current_user do
      {:cont, socket}
    else
      {:halt, Phoenix.LiveView.redirect(socket, to: "/login")}
    end
  end

  defp assign_current_user(socket, session) do
    token = session["user_token"]
    Logger.info("[UserAuth] on_mount — session user_token present: #{is_binary(token)}")

    user =
      with token when is_binary(token) <- token,
           {:ok, user} <- Accounts.fetch_user_by_session_token(token) do
        Logger.info("[UserAuth] on_mount — resolved user: #{user.email} (#{user.role})")
        user
      else
        _ ->
          Logger.warning("[UserAuth] on_mount — no valid session token, user is nil")
          nil
      end

    Phoenix.Component.assign(socket, :current_user, user)
  end

  defp ensure_user_token(conn) do
    if token = get_session(conn, :user_token) do
      {token, conn}
    else
      conn = fetch_cookies(conn, signed: [@remember_me_cookie])

      if token = conn.cookies[@remember_me_cookie] do
        {token, put_token_in_session(conn, token)}
      else
        {nil, conn}
      end
    end
  end

  defp put_token_in_session(conn, token) do
    conn
    |> put_session(:user_token, token)
    |> put_session(:live_socket_id, "users_sessions:#{Base.url_encode64(token)}")
  end
end
