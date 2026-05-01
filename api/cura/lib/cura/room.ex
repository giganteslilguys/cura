defmodule Cura.Room do
  @moduledoc false

  use GenServer
  require Logger

  alias Cura.{Peer, PeerSupervisor}

  @type room_id :: String.t()

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  @spec add_peer(pid(), room_id()) :: {:ok, Peer.id()} | {:error, term()}
  def add_peer(channel_pid, room_id) do
    GenServer.call(__MODULE__, {:add_peer, channel_pid, room_id})
  end

  @spec remove_peer(Peer.id(), room_id()) :: :ok
  def remove_peer(peer_id, room_id) do
    GenServer.cast(__MODULE__, {:remove_peer, peer_id, room_id})
  end

  @spec mark_ready(Peer.id()) :: :ok
  def mark_ready(peer_id) do
    GenServer.cast(__MODULE__, {:mark_ready, peer_id})
  end

  @impl true
  def init(_opts) do
    {:ok, %{}}
  end

  @impl true
  def handle_call({:add_peer, channel_pid, room_id}, _from, state) do
    room_state = Map.get(state, room_id, %{peers: [], ready_peers: MapSet.new()})
    current_peers = room_state.peers

    if length(current_peers) >= get_room_capacity() do
      {:reply, {:error, :room_full}, state}
    else
      peer_id = generate_peer_id()
      peer_ids = Enum.map(current_peers, fn {id, _pid} -> id end)

      case PeerSupervisor.add_peer(peer_id, channel_pid, peer_ids, room_id) do
        {:ok, _pid} ->
          updated_peers = [{peer_id, channel_pid} | current_peers]
          updated_room_state = %{room_state | peers: updated_peers}
          new_state = Map.put(state, room_id, updated_room_state)

          Enum.each(current_peers, fn {id, _pid} ->
            Peer.notify(id, {:peer_added, peer_id})
          end)

          Logger.info(
            "Added peer #{peer_id} to room #{room_id}. Room now has #{length(updated_peers)} peers"
          )

          {:reply, {:ok, peer_id}, new_state}

        {:error, reason} ->
          {:reply, {:error, reason}, state}
      end
    end
  end

  @impl true
  def handle_cast({:remove_peer, peer_id, room_id}, state) do
    case Map.get(state, room_id) do
      nil ->
        Logger.debug("Attempted to remove peer #{peer_id} from non-existent room #{room_id}")
        {:noreply, state}

      room_state ->
        # Remove from room-specific peer list
        updated_peers = Enum.reject(room_state.peers, fn {id, _pid} -> id == peer_id end)
        updated_ready_peers = MapSet.delete(room_state.ready_peers, peer_id)

        # Check if peer was actually in the room
        peer_was_present = length(updated_peers) < length(room_state.peers)

        if peer_was_present do
          updated_room_state = %{
            peers: updated_peers,
            ready_peers: updated_ready_peers
          }

          new_state =
            if Enum.empty?(updated_peers) do
              # Remove empty room
              Logger.info("Room #{room_id} is now empty, removing it")
              Map.delete(state, room_id)
            else
              Map.put(state, room_id, updated_room_state)
            end

          # Notify remaining peers in this room only
          Enum.each(updated_peers, fn {id, _pid} ->
            Peer.notify(id, {:peer_removed, peer_id})
          end)

          # Terminate the peer process
          PeerSupervisor.terminate_peer(peer_id)

          Logger.info(
            "Removed peer #{peer_id} from room #{room_id}. Room now has #{length(updated_peers)} peers"
          )

          {:noreply, new_state}
        else
          Logger.debug("Peer #{peer_id} was not found in room #{room_id}, ignoring removal")
          {:noreply, state}
        end
    end
  end

  @impl true
  def handle_cast({:mark_ready, peer_id}, state) do
    # Find which room this peer belongs to
    {room_id, room_state} =
      Enum.find(state, fn {_room_id, room_state} ->
        Enum.any?(room_state.peers, fn {id, _pid} -> id == peer_id end)
      end) || {nil, nil}

    if room_state do
      updated_ready_peers = MapSet.put(room_state.ready_peers, peer_id)
      updated_room_state = %{room_state | ready_peers: updated_ready_peers}
      new_state = Map.put(state, room_id, updated_room_state)

      Logger.debug("Marked peer #{peer_id} as ready in room #{room_id}")
      {:noreply, new_state}
    else
      {:noreply, state}
    end
  end

  defp generate_peer_id do
    :crypto.strong_rand_bytes(16) |> Base.encode16(case: :lower)
  end

  defp get_room_capacity do
    1000
  end
end
