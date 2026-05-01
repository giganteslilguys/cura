defmodule CuraWeb.UserSocket do
  use Phoenix.Socket
  require Logger

  channel "peer:*", CuraWeb.PeerChannel

  @impl true
  def connect(_params, socket, %{session: session}) do
    token = session[:user_token] || session["user_token"]
    Logger.info("[UserSocket] connect — session token present: #{is_binary(token)}")

    with token when is_binary(token) <- token,
         {:ok, user} <- Cura.Accounts.fetch_user_by_session_token(token) do
      Logger.info("[UserSocket] connect — authenticated as #{user.email} (#{user.role})")
      {:ok, assign(socket, :current_user, user)}
    else
      _ ->
        Logger.warning("[UserSocket] connect — rejected, no valid session token")
        :error
    end
  end

  def connect(_params, _socket, _connect_info) do
    Logger.warning("[UserSocket] connect — rejected, no connect_info/session")
    :error
  end

  @impl true
  def id(socket), do: "user_socket:#{socket.assigns.current_user.id}"
end
