defmodule CuraWeb.Api.AuthController do
  use CuraWeb, :controller

  alias Cura.Accounts

  action_fallback CuraWeb.FallbackController

  def sign_up(conn, params) do
    case Accounts.register_user(params) do
      {:ok, user} ->
        token = Accounts.generate_user_session_token(user)

        conn
        |> put_status(:created)
        |> render(:user_with_token, user: user, token: token)

      {:error, %Ecto.Changeset{} = changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> put_view(json: CuraWeb.ChangesetJSON)
        |> render(:errors, changeset: changeset)
    end
  end

  def sign_in(conn, %{"email" => email, "password" => password})
      when is_binary(email) and is_binary(password) do
    case Accounts.get_user_by_email_and_password(email, password) do
      nil ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "invalid email or password"})

      user ->
        token = Accounts.generate_user_session_token(user)
        render(conn, :user_with_token, user: user, token: token)
    end
  end

  def sign_in(conn, _params) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: "email and password are required"})
  end

  def sign_out(conn, _params) do
    Accounts.delete_user_session_token(conn.assigns.current_token)

    conn
    |> put_status(:ok)
    |> json(%{ok: true})
  end

  def me(conn, _params) do
    render(conn, :user, user: conn.assigns.current_user)
  end
end
