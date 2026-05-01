defmodule CuraWeb.PeerChannel do
  @moduledoc false

  use CuraWeb, :channel

  require Logger

  alias Cura.{Peer, Room}
  alias CuraWeb.Presence

  @spec send_offer(GenServer.server(), String.t()) :: :ok
  def send_offer(channel, offer) do
    GenServer.cast(channel, {:offer, offer})
  end

  @spec send_candidate(GenServer.server(), String.t()) :: :ok
  def send_candidate(channel, candidate) do
    GenServer.cast(channel, {:candidate, candidate})
  end

  @spec send_answer(GenServer.server(), String.t()) :: :ok
  def send_answer(channel, answer) do
    GenServer.cast(channel, {:answer, answer})
  end

  @spec close(GenServer.server()) :: :ok
  def close(channel) do
    try do
      GenServer.stop(channel, :shutdown)
    catch
      _exit_or_error, _e -> :ok
    end

    :ok
  end

  @impl true
  def join("peer:signalling:" <> room_id, _payload, socket) do
    room_id = String.trim(room_id)
    current_user = socket.assigns.current_user

    with true <- valid_room_id?(room_id),
         {:ok, meeting} <- Cura.Meetings.get_meeting!(room_id),
         true <- meeting.doctor_id == current_user.id or meeting.patient_id == current_user.id do
      pid = self()
      send(pid, :after_join)

      case Room.add_peer(pid, room_id) do
        {:ok, id} ->
          Logger.info("Peer #{id} (user #{current_user.id}) joined room #{room_id}")
          {:ok, socket |> assign(:peer, id) |> assign(:room_id, room_id)}

        {:error, reason} = error ->
          Logger.error("Failed to add peer to room #{room_id}: #{inspect(reason)}")
          error
      end
    else
      _ ->
        Logger.warning("Unauthorized channel join attempt for room #{room_id} by user #{current_user.id}")
        {:error, %{reason: "unauthorized"}}
    end
  end

  @impl true
  def handle_in("sdp_answer", %{"body" => body}, socket) do
    Logger.info("Received SDP answer from peer #{socket.assigns.peer}")

    # Apply the SDP answer to our peer connection
    :ok = Peer.apply_sdp_answer(socket.assigns.peer, body)
    Logger.info("Applied SDP answer for peer #{socket.assigns.peer}")
    {:noreply, socket}
  end

  @impl true
  def handle_in("sdp_offer", %{"body" => body}, socket) do
    Logger.info("Received SDP offer from peer #{socket.assigns.peer} for renegotiation")

    # For renegotiation scenarios (like screen sharing), we need to handle this
    # as a new negotiation cycle, not just broadcast it
    case Peer.handle_renegotiation_offer(socket.assigns.peer, body) do
      :ok ->
        Logger.info("Successfully handled renegotiation offer from #{socket.assigns.peer}")
        {:noreply, socket}

      {:error, reason} ->
        Logger.warning(
          "Failed to handle renegotiation offer from #{socket.assigns.peer}: #{inspect(reason)}"
        )

        {:noreply, socket}
    end
  end

  @impl true
  def handle_in("ice_candidate", %{"body" => body}, socket) do
    Peer.add_ice_candidate(socket.assigns.peer, body)
    {:noreply, socket}
  end

  @impl true
  def handle_in("screen_share_started", _payload, socket) do
    Logger.info("Peer #{socket.assigns.peer} started screen sharing")

    # Broadcast to all other peers that this peer started screen sharing
    broadcast_from!(socket, "screen_share_started", %{})
    {:noreply, socket}
  end

  @impl true
  def handle_in("screen_share_stopped", _payload, socket) do
    Logger.info("Peer #{socket.assigns.peer} stopped screen sharing")

    # Broadcast to all other peers that this peer stopped screen sharing
    broadcast_from!(socket, "screen_share_stopped", %{})
    {:noreply, socket}
  end

  @impl true
  def handle_in("request_new_offer", _payload, socket) do
    Logger.info(
      "Peer #{socket.assigns.peer} requested new offer (for ICE restart or renegotiation)"
    )

    # Trigger the peer to send a new offer by notifying it
    # This will cause the peer to create a new offer with fresh ICE credentials
    Peer.notify(socket.assigns.peer, :send_new_offer)

    {:noreply, socket}
  end

  # Audio recording is now handled via LiveView events in CallsLive.Calls
  # The old PeerChannel audio_chunk handler has been removed

  @impl true
  def handle_cast({:offer, sdp_offer}, socket) do
    Logger.info(
      "PeerChannel pushing SDP offer to client. Socket topic: #{socket.topic}, Peer: #{socket.assigns[:peer]}"
    )

    push(socket, "sdp_offer", %{"body" => sdp_offer})
    Logger.info("SDP offer pushed successfully")
    {:noreply, socket}
  end

  @impl true
  def handle_cast({:candidate, candidate}, socket) do
    push(socket, "ice_candidate", %{"body" => candidate})
    {:noreply, socket}
  end

  @impl true
  def handle_cast({:answer, sdp_answer}, socket) do
    push(socket, "sdp_answer", %{"body" => sdp_answer})
    {:noreply, socket}
  end

  @impl true
  def handle_info(:after_join, socket) do
    peer_id = socket.assigns.peer
    room_id = socket.assigns.room_id

    # Track this peer in presence with room-specific context
    {:ok, _ref} =
      Presence.track(socket, peer_id, %{
        online_at: inspect(System.system_time(:second)),
        joined_at: DateTime.utc_now() |> DateTime.to_iso8601(),
        room_id: room_id
      })

    Process.send_after(self(), {:broadcast_presence, peer_id}, 100)

    {:noreply, socket}
  end

  @impl true
  def handle_info({:broadcast_presence, peer_id}, socket) do
    room_id = socket.assigns.room_id

    # Get presence state for this specific room
    presence_state = Presence.list(socket)
    participant_count = map_size(presence_state)

    Logger.info(
      "Peer #{peer_id} joined room #{room_id}. Total participants: #{participant_count}"
    )

    # Broadcast only to peers in the same room
    broadcast!(socket, "presence_diff", %{
      joins: %{
        peer_id => %{
          metas: [
            %{
              online_at: inspect(System.system_time(:second)),
              joined_at: DateTime.utc_now() |> DateTime.to_iso8601(),
              room_id: room_id
            }
          ]
        }
      },
      leaves: %{}
    })

    {:noreply, socket}
  end

  @impl true
  def terminate(reason, socket) do
    # Only clean up if peer was successfully added (join succeeded)
    case Map.get(socket.assigns, :peer) do
      nil ->
        Logger.info("Channel terminating before peer was added. Reason: #{inspect(reason)}")
        :ok

      peer_id ->
        room_id = socket.assigns.room_id
        Logger.info("Peer #{peer_id} leaving room #{room_id}. Reason: #{inspect(reason)}")

        # Remove peer from room state first
        Room.remove_peer(peer_id, room_id)

        # Get current presence state before termination to ensure accurate count
        presence_state = Presence.list(socket)

        # Remove this peer from presence manually to get accurate remaining count
        remaining_participants = Map.delete(presence_state, peer_id)
        remaining_count = map_size(remaining_participants)

        Logger.info(
          "After #{peer_id} leaves room #{room_id}, remaining participants: #{remaining_count}"
        )

        # Broadcast presence diff with accurate leave information
        broadcast_from!(socket, "presence_diff", %{
          joins: %{},
          leaves: %{
            peer_id => %{
              metas: [
                %{
                  online_at: inspect(System.system_time(:second)),
                  left_at: DateTime.utc_now() |> DateTime.to_iso8601(),
                  room_id: room_id,
                  final_count: remaining_count
                }
              ]
            }
          }
        })

        # Additional delay to ensure all cleanup completes
        Process.sleep(100)

        Logger.debug("Completed cleanup for peer #{peer_id} leaving room #{room_id}")
        :ok
    end
  end

  # Helper function to validate room IDs
  defp valid_room_id?(room_id) do
    # Add your validation logic here
    # Example: only allow alphanumeric characters and certain length
    String.match?(room_id, ~r/^[a-zA-Z0-9_-]{1,50}$/)
  end
end
