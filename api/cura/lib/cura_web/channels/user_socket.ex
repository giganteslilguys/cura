defmodule CuraWeb.UserSocket do
  use Phoenix.Socket
  require Logger

  channel "room:*", CuraWeb.SignalChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) when is_binary(token) do
    case Cura.Accounts.fetch_user_by_session_token(token) do
      {:ok, user} ->
        Logger.info("[UserSocket] connect — authenticated as #{user.email} (#{user.role})")
        {:ok, assign(socket, :current_user, user)}

      _ ->
        Logger.warning("[UserSocket] connect — rejected, invalid token")
        :error
    end
  end

  def connect(_params, _socket, _connect_info) do
    Logger.warning("[UserSocket] connect — rejected, no token in params")
    :error
  end

  @impl true
  def id(socket), do: "user_socket:#{socket.assigns.current_user.id}"
end
