defmodule CuraWeb.SessionController do
  use CuraWeb, :browser_controller

  alias Cura.Accounts

  def new(conn, _params) do
    render(conn, :new, error: nil)
  end

  def create(conn, %{"email" => email, "password" => password}) do
    case Accounts.get_user_by_email_and_password(email, password) do
      nil ->
        render(conn, :new, error: "Invalid email or password")

      user ->
        token = Accounts.generate_user_session_token(user)
        return_to = get_session(conn, :return_to) || "/meetings"

        conn
        |> put_session(:user_token, token)
        |> delete_session(:return_to)
        |> redirect(to: return_to)
    end
  end

  def delete(conn, _params) do
    if token = get_session(conn, :user_token) do
      Accounts.delete_user_session_token(token)
    end

    conn
    |> clear_session()
    |> redirect(to: "/login")
  end
end
