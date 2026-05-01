defmodule Cura.PeerSupervisor do
  @moduledoc false

  use DynamicSupervisor

  require Logger

  alias Cura.Peer

  @spec start_link(any()) :: DynamicSupervisor.on_start_child()
  def start_link(arg) do
    DynamicSupervisor.start_link(__MODULE__, arg, name: __MODULE__)
  end

  @spec add_peer(String.t(), pid(), [String.t()]) :: {:ok, pid()}
  def add_peer(id, channel_pid, peer_ids) do
    add_peer(id, channel_pid, peer_ids, nil)
  end

  @spec add_peer(String.t(), pid(), [String.t()], String.t() | nil) :: {:ok, pid()}
  def add_peer(id, channel_pid, peer_ids, room_id) do
    peer_opts = [id, channel_pid, peer_ids, room_id]
    gen_server_opts = [name: Peer.registry_id(id)]

    child_spec = %{
      id: Peer,
      start: {Peer, :start_link, [peer_opts, gen_server_opts]},
      restart: :temporary
    }

    DynamicSupervisor.start_child(__MODULE__, child_spec)
  end

  @spec terminate_peer(Peer.id()) :: :ok
  def terminate_peer(peer) do
    try do
      peer |> Peer.registry_id() |> GenServer.stop(:shutdown)
    catch
      _exit_or_error, _e -> :ok
    end

    :ok
  end

  @impl true
  def init(_arg) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end
end
