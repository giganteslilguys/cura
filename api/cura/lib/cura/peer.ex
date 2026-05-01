defmodule Cura.Peer do
  @moduledoc false

  use GenServer

  require Logger

  alias ExWebRTC.{
    ICECandidate,
    MediaStreamTrack,
    PeerConnection,
    RTPCodecParameters,
    SessionDescription
  }

  alias Cura.Room
  alias CuraWeb.PeerChannel

  @type id :: String.t()

  @type tracks_spec :: %{video: String.t() | nil, audio: String.t() | nil}
  @type outbound_tracks_spec :: %{
          stream: String.t(),
          video: String.t() | nil,
          audio: String.t() | nil,
          transceivers: tracks_spec(),
          subscribed?: boolean()
        }
  @type peer_tracks_spec :: %{
          stream: String.t(),
          video: String.t() | nil,
          audio: String.t() | nil,
          transceivers: tracks_spec(),
          pc: pid()
        }

  @type state :: %{
          id: id(),
          channel: pid(),
          pc: pid(),
          room_id: String.t() | nil,
          # Tracks streamed from the browser to the peer
          inbound_tracks: tracks_spec(),
          # Tracks streamed from the peer to the browser
          outbound_tracks: %{id() => outbound_tracks_spec()},
          # Tracks of other peers which are subscribed to us
          # We forward the media received on `inbound_tracks` to these tracks
          peer_tracks: %{id() => peer_tracks_spec()},
          # Peers that will be added/removed after the current renegotiation completes
          pending_peers: MapSet.t(id() | {:removed, id()})
        }

  @audio_codecs [
    %RTPCodecParameters{
      payload_type: 111,
      mime_type: "audio/opus",
      clock_rate: 48_000,
      channels: 2
    }
  ]

  @video_codecs [
    %RTPCodecParameters{
      payload_type: 96,
      mime_type: "video/VP8",
      clock_rate: 90_000
    }
  ]

  @opts [
    ice_servers: [
      %{urls: "stun:stun.l.google.com:19302"},
      %{urls: "stun:stun1.l.google.com:19302"},
      %{urls: "stun:stun2.l.google.com:19302"},
      %{urls: "stun:stun3.l.google.com:19302"},
      %{urls: "stun:stun4.l.google.com:19302"}
    ],
    audio_codecs: @audio_codecs,
    video_codecs: @video_codecs
  ]

  @spec start_link(term(), term()) :: GenServer.on_start()
  def start_link(args, opts) do
    GenServer.start_link(__MODULE__, args, opts)
  end

  @spec apply_sdp_answer(id(), String.t()) :: :ok
  def apply_sdp_answer(id, answer_sdp) do
    GenServer.call(registry_id(id), {:apply_sdp_answer, answer_sdp})
  end

  @spec add_ice_candidate(id(), String.t()) :: :ok
  def add_ice_candidate(id, body) do
    GenServer.call(registry_id(id), {:add_ice_candidate, body})
  end

  @spec add_subscriber(id(), id(), peer_tracks_spec()) :: :ok
  def add_subscriber(id, peer, peer_tracks_spec) do
    GenServer.cast(registry_id(id), {:add_subscriber, peer, peer_tracks_spec})
  end

  @spec request_keyframe(id()) :: :ok
  def request_keyframe(id) do
    GenServer.cast(registry_id(id), :request_keyframe)
  end

  @spec notify(id(), term()) :: :ok
  def notify(id, msg) do
    GenServer.cast(registry_id(id), msg)
  end

  @spec registry_id(id()) :: term()
  def registry_id(id), do: {:via, Registry, {Cura.PeerRegistry, id}}

  @impl true
  def init([id, channel, peer_ids]) do
    init([id, channel, peer_ids, nil])
  end

  def init([id, channel, peer_ids, room_id]) do
    Logger.debug("Starting new peer #{id} for room #{inspect(room_id)}")
    ice_port_range = 50000..55000
    pc_opts = @opts ++ [ice_port_range: ice_port_range]
    {:ok, pc} = PeerConnection.start_link(pc_opts)
    Process.monitor(pc)
    Logger.debug("Starting peer connection #{inspect(pc)}")

    Process.link(channel)

    state = %{
      id: id,
      channel: channel,
      pc: pc,
      room_id: room_id,
      inbound_tracks: %{video: nil, audio: nil},
      outbound_tracks: %{},
      peer_tracks: %{},
      pending_peers: MapSet.new()
    }

    {:ok, state, {:continue, {:initial_offer, peer_ids}}}
  end

  @impl true
  def handle_continue({:initial_offer, peer_ids}, %{pc: pc} = state) do
    Logger.debug("Creating initial SDP offer for #{state.id}")

    Logger.info(
      "Peer #{state.id} will create outbound tracks for existing peers: #{inspect(peer_ids)}"
    )

    outbound_tracks = setup_transceivers(pc, peer_ids)

    Logger.info(
      "Peer #{state.id} created outbound tracks for: #{inspect(Map.keys(outbound_tracks))}"
    )

    state = send_offer(state)

    {:noreply, %{state | outbound_tracks: outbound_tracks}}
  end

  @impl true
  def handle_call({:apply_sdp_answer, answer_sdp}, _from, %{pc: pc} = state) do
    answer = %SessionDescription{type: :answer, sdp: answer_sdp}
    Logger.debug("Applying SDP answer for #{state.id}:\n#{answer.sdp}")

    # Check the current signaling state before applying the answer
    signaling_state = PeerConnection.get_signaling_state(pc)
    Logger.debug("Current signaling state for #{state.id}: #{signaling_state}")

    state =
      case {signaling_state, PeerConnection.set_remote_description(pc, answer)} do
        {:have_local_offer, :ok} ->
          Logger.debug("Successfully applied SDP answer for #{state.id}")

          state
          |> subscribe_to_new_tracks()
          |> handle_pending_peers()

        {:have_local_offer, {:error, reason}} ->
          Logger.warning("Unable to apply SDP answer for #{state.id}: #{inspect(reason)}")
          state

        {other_state, _} ->
          Logger.warning(
            "Cannot apply SDP answer for #{state.id} in signaling state #{other_state}"
          )

          state
      end

    {:reply, :ok, state}
  end

  @impl true
  def handle_call({:add_ice_candidate, body}, _from, %{pc: pc} = state) do
    candidate =
      body
      |> Jason.decode!()
      |> ICECandidate.from_json()

    case PeerConnection.add_ice_candidate(pc, candidate) do
      :ok ->
        {:reply, :ok, state}

      {:error, :no_remote_description} ->
        Logger.debug(
          "ICE candidate received before remote description for peer #{state.id}, ignoring"
        )

        {:reply, :ok, state}

      {:error, reason} ->
        Logger.warning("Failed to add ICE candidate for peer #{state.id}: #{inspect(reason)}")
        {:reply, :ok, state}
    end
  end

  @impl true
  def handle_call({:handle_renegotiation_offer, offer_sdp}, _from, %{pc: pc} = state) do
    offer = %SessionDescription{type: :offer, sdp: offer_sdp}
    Logger.debug("Handling renegotiation offer for #{state.id}:\n#{offer.sdp}")

    # Check the current signaling state
    signaling_state = PeerConnection.get_signaling_state(pc)
    Logger.debug("Current signaling state for renegotiation #{state.id}: #{signaling_state}")

    result =
      case {signaling_state, PeerConnection.set_remote_description(pc, offer)} do
        {:stable, :ok} ->
          Logger.debug("Successfully set remote description for renegotiation #{state.id}")

          # Create and send answer
          case PeerConnection.create_answer(pc) do
            {:ok, answer} ->
              :ok = PeerConnection.set_local_description(pc, answer)
              :ok = PeerChannel.send_answer(state.channel, answer.sdp)
              Logger.debug("Sent renegotiation answer for #{state.id}")
              :ok

            {:error, reason} ->
              Logger.warning(
                "Failed to create renegotiation answer for #{state.id}: #{inspect(reason)}"
              )

              {:error, reason}
          end

        {:stable, {:error, reason}} ->
          Logger.warning(
            "Unable to set remote description for renegotiation #{state.id}: #{inspect(reason)}"
          )

          {:error, reason}

        {other_state, _} ->
          Logger.warning(
            "Cannot handle renegotiation offer for #{state.id} in signaling state #{other_state}"
          )

          {:error, :invalid_signaling_state}
      end

    {:reply, result, state}
  end

  @impl true
  def handle_cast(:request_keyframe, %{pc: pc} = state) do
    inbound_video_track_id = state.inbound_tracks.video

    unless is_nil(inbound_video_track_id) do
      :ok = PeerConnection.send_pli(pc, inbound_video_track_id)
    end

    {:noreply, state}
  end

  @impl true
  def handle_cast({:add_subscriber, peer, spec}, state) do
    Logger.info("Peer #{state.id} received subscribe request from peer #{peer}")

    Logger.debug(
      "Subscription spec: video=#{spec.video}, audio=#{spec.audio}, stream=#{spec.stream}"
    )

    {:noreply, put_in(state.peer_tracks[peer], spec)}
  end

  @impl true
  def handle_cast({:peer_added, id}, %{id: id} = state) do
    {:noreply, state}
  end

  @impl true
  def handle_cast({:peer_added, peer}, %{pc: pc} = state) do
    if PeerConnection.get_signaling_state(pc) == :have_local_offer do
      Logger.debug("Peer #{state.id} scheduled adding of #{peer} after receiving SDP answer")
      pending_peers = MapSet.put(state.pending_peers, peer)

      {:noreply, %{state | pending_peers: pending_peers}}
    else
      {:noreply, state |> add_peer(peer) |> send_offer()}
    end
  end

  @impl true
  def handle_cast({:peer_removed, peer}, %{pc: pc} = state) do
    if PeerConnection.get_signaling_state(pc) == :have_local_offer do
      Logger.debug("Peer #{state.id} scheduled removal of #{peer} after receiving SDP answer")

      pending_peers =
        if MapSet.member?(state.pending_peers, peer),
          do: MapSet.delete(state.pending_peers, peer),
          else: MapSet.put(state.pending_peers, {:removed, peer})

      {:noreply, %{state | pending_peers: pending_peers}}
    else
      {:noreply, state |> remove_peer(peer) |> send_offer()}
    end
  end

  @impl true
  def handle_cast(:send_new_offer, state) do
    Logger.info("Peer #{state.id} generating new offer for renegotiation")
    {:noreply, send_offer(state)}
  end

  @impl true
  def handle_info({:ex_webrtc, pc, {:ice_candidate, candidate}}, %{pc: pc} = state) do
    body =
      candidate
      |> ICECandidate.to_json()
      |> Jason.encode!()

    :ok = PeerChannel.send_candidate(state.channel, body)

    {:noreply, state}
  end

  @impl true
  def handle_info({:ex_webrtc, pc, {:connection_state_change, :connected}}, %{pc: pc} = state) do
    Logger.info("Peer #{state.id} WebRTC connection CONNECTED. peer_tracks=#{inspect(Map.keys(state.peer_tracks))} inbound=#{inspect(state.inbound_tracks)}")
    :ok = Room.mark_ready(state.id)

    {:noreply, state}
  end

  @impl true
  def handle_info({:ex_webrtc, pc, {:connection_state_change, :failed}}, %{pc: pc} = state) do
    Logger.warning("Peer #{state.id} connection failed - monitoring for client recovery")

    # Don't stop immediately - give the client time to attempt ICE restart
    # Schedule a delayed check to see if recovery happened
    Process.send_after(self(), {:check_connection_recovery, pc}, 15_000)
    {:noreply, state}
  end

  @impl true
  def handle_info({:ex_webrtc, pc, {:connection_state_change, state_change}}, %{pc: pc} = state) do
    Logger.debug("Peer #{state.id} connection state changed to #{state_change}")
    {:noreply, state}
  end

  @impl true
  def handle_info({:ex_webrtc, pc, {:ice_connection_state_change, :failed}}, %{pc: pc} = state) do
    Logger.warning(
      "Peer #{state.id} ICE connection state changed to failed - will attempt recovery"
    )

    # Don't stop immediately, let the connection_state_change handler deal with it
    # or wait for client-side ICE restart
    {:noreply, state}
  end

  @impl true
  def handle_info(
        {:ex_webrtc, pc, {:ice_connection_state_change, :disconnected}},
        %{pc: pc} = state
      ) do
    Logger.info(
      "Peer #{state.id} ICE connection state changed to disconnected - waiting for reconnection"
    )

    # Schedule a check if still disconnected after 10 seconds
    Process.send_after(self(), {:check_ice_disconnected, pc}, 10_000)
    {:noreply, state}
  end

  @impl true
  def handle_info({:ex_webrtc, pc, {:ice_connection_state_change, ice_state}}, %{pc: pc} = state) do
    Logger.debug("Peer #{state.id} ICE connection state changed to #{ice_state}")
    {:noreply, state}
  end

  # Handle delayed disconnection check
  @impl true
  def handle_info({:check_ice_disconnected, pc}, %{pc: pc} = state) do
    # Check if still in peer connection
    case PeerConnection.get_ice_connection_state(pc) do
      :disconnected ->
        Logger.warning(
          "Peer #{state.id} ICE connection is disconnected, will check again in 5 seconds"
        )

        # Let the client handle ICE restart, we'll check if it recovered after a delay
        Process.send_after(self(), {:check_connection_recovery, pc}, 15_000)

        {:noreply, state}

      _other_state ->
        Logger.debug("Peer #{state.id} recovered from disconnected state")
        {:noreply, state}
    end
  end

  # Ignore stale disconnection checks
  def handle_info({:check_ice_disconnected, _old_pc}, state) do
    {:noreply, state}
  end

  # Check if connection recovered from failure
  def handle_info({:check_connection_recovery, pc}, %{pc: pc} = state) do
    connection_state = PeerConnection.get_connection_state(pc)

    case connection_state do
      :failed ->
        Logger.error("Peer #{state.id} connection did not recover, remains in failed state")
        # Could notify the frontend or clean up resources here
        {:noreply, state}

      :connected ->
        Logger.info("Peer #{state.id} connection recovered successfully")
        {:noreply, state}

      other_state ->
        Logger.info("Peer #{state.id} connection state is #{other_state}, monitoring")
        {:noreply, state}
    end
  end

  # Ignore stale recovery checks
  def handle_info({:check_connection_recovery, _old_pc}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_info({:ex_webrtc, pc, {:signaling_state_change, signaling_state}}, %{pc: pc} = state) do
    Logger.debug("Peer #{state.id} signaling state changed to #{signaling_state}")
    {:noreply, state}
  end

  @impl true
  def handle_info({:ex_webrtc, pc, :negotiation_needed}, %{pc: pc} = state) do
    Logger.debug("Peer #{state.id} negotiation needed")
    {:noreply, state}
  end

  @impl true
  def handle_info({:ex_webrtc, pc, {:dtls_transport_state_change, dtls_state}}, %{pc: pc} = state) do
    Logger.debug("Peer #{state.id} DTLS transport state changed to #{dtls_state}")
    {:noreply, state}
  end

  @impl true
  def handle_info(
        {:ex_webrtc, pc, {:ice_gathering_state_change, gathering_state}},
        %{pc: pc} = state
      ) do
    Logger.debug("Peer #{state.id} ICE gathering state changed to #{gathering_state}")
    {:noreply, state}
  end

  @impl true
  def handle_info({:ex_webrtc, pc, {:rtp, id, _rid, packet}}, %{pc: pc} = state) do
    case state.inbound_tracks do
      %{video: ^id} ->
        log_first_rtp(state.id, :video, state.peer_tracks)
        broadcast_packet(state.peer_tracks, :video, packet)

      %{audio: ^id} ->
        log_first_rtp(state.id, :audio, state.peer_tracks)
        broadcast_packet(state.peer_tracks, :audio, packet)

      _ ->
        Logger.warning(
          "Peer #{state.id} ignoring RTP packet for unknown track #{inspect(id)}. Known tracks: #{inspect(state.inbound_tracks)}"
        )

        :noop
    end

    {:noreply, state}
  end

  @impl true
  def handle_info({:ex_webrtc, pc, {:rtcp, packets}}, %{pc: pc} = state) do
    Enum.each(packets, fn
      {track_id, %ExRTCP.Packet.PayloadFeedback.PLI{}} ->
        {peer_id, _} =
          Enum.find(state.outbound_tracks, {nil, nil}, fn {_, spec} -> spec.video == track_id end)

        unless is_nil(peer_id), do: request_keyframe(peer_id)

      _other ->
        :noop
    end)

    {:noreply, state}
  end

  @impl true
  def handle_info({:ex_webrtc, pc, {:track, track}}, %{pc: pc} = state) do
    Logger.info("Peer #{state.id} received #{track.kind} track #{track.id} from remote peer")

    state = put_in(state.inbound_tracks[track.kind], track.id)

    Logger.info("Peer #{state.id} inbound tracks now: #{inspect(state.inbound_tracks)}")

    {:noreply, state}
  end

  @impl true
  def handle_info({:DOWN, _ref, :process, pc, reason}, %{pc: pc} = state) do
    Logger.warning(
      "Peer #{state.id} shutting down: peer connection process #{inspect(pc)} terminated with reason #{inspect(reason)}"
    )

    {:stop, {:shutdown, :peer_connection_closed}, state}
  end

  @impl true
  def handle_info(msg, state) do
    Logger.debug("Ignoring unknown message: #{inspect(msg)}")
    {:noreply, state}
  end

  @spec handle_renegotiation_offer(id(), String.t()) :: :ok | {:error, term()}
  def handle_renegotiation_offer(id, offer_sdp) do
    GenServer.call(registry_id(id), {:handle_renegotiation_offer, offer_sdp})
  end

  @spec setupLocalMedia() :: :ok
  def setupLocalMedia() do
    # This is handled on the frontend
    :ok
  end

  @spec toggleMute() :: :ok
  def toggleMute() do
    # This is handled on the frontend
    :ok
  end

  @spec removeScreenShare() :: :ok
  def removeScreenShare() do
    # This is handled on the frontend
    :ok
  end

  defp setup_transceivers(pc, peer_ids) do
    # Inbound tracks
    {:ok, _tr} = PeerConnection.add_transceiver(pc, :video, direction: :recvonly)
    {:ok, _tr} = PeerConnection.add_transceiver(pc, :audio, direction: :recvonly)

    # Outbound tracks
    Map.new(peer_ids, fn id ->
      {id, add_outbound_track_pair(pc)}
    end)
  end

  defp add_outbound_track_pair(pc) do
    stream_id = MediaStreamTrack.generate_stream_id()
    vt = MediaStreamTrack.new(:video, [stream_id])
    at = MediaStreamTrack.new(:audio, [stream_id])

    {:ok, video_tr} = PeerConnection.add_transceiver(pc, :video, direction: :sendonly)
    :ok = PeerConnection.replace_track(pc, video_tr.sender.id, vt)

    {:ok, audio_tr} = PeerConnection.add_transceiver(pc, :audio, direction: :sendonly)
    :ok = PeerConnection.replace_track(pc, audio_tr.sender.id, at)

    transceivers = %{video: video_tr.id, audio: audio_tr.id}

    %{
      stream: stream_id,
      video: vt.id,
      audio: at.id,
      transceivers: transceivers,
      subscribed?: false
    }
  end

  defp add_peer(state, peer) do
    Logger.debug("Peer #{state.id} preparing to receive media from #{peer}")
    tracks = add_outbound_track_pair(state.pc)

    put_in(state.outbound_tracks[peer], tracks)
  end

  defp remove_peer(state, peer) do
    Logger.debug("Peer #{state.id} removing outbound tracks corresponding to peer #{peer}")

    {_, state} = pop_in(state.peer_tracks[peer])
    {spec, state} = pop_in(state.outbound_tracks[peer])

    :ok = PeerConnection.stop_transceiver(state.pc, spec.transceivers.video)
    :ok = PeerConnection.stop_transceiver(state.pc, spec.transceivers.audio)

    state
  end

  defp subscribe_to_new_tracks(state) do
    Logger.debug(
      "Peer #{state.id} subscribing to new tracks. Outbound tracks: #{inspect(Map.keys(state.outbound_tracks))}"
    )

    outbound_tracks =
      state.outbound_tracks
      |> Map.new(fn {peer, spec} ->
        unless spec.subscribed? do
          Logger.info("Peer #{state.id} subscribing to peer #{peer}'s media")

          spec
          |> Map.delete(:subscribed?)
          |> Map.put(:pc, state.pc)
          |> then(&add_subscriber(peer, state.id, &1))
        else
          Logger.debug("Peer #{state.id} already subscribed to peer #{peer}")
        end

        {peer, %{spec | subscribed?: true}}
      end)

    Logger.debug(
      "Peer #{state.id} finished subscribing. All subscribed: #{inspect(Map.keys(outbound_tracks))}"
    )

    %{state | outbound_tracks: outbound_tracks}
  end

  defp handle_pending_peers(state) do
    if Enum.empty?(state.pending_peers) do
      state
    else
      Enum.reduce(state.pending_peers, state, fn
        {:removed, peer}, state ->
          remove_peer(state, peer)

        peer, state ->
          add_peer(state, peer)
      end)
      |> send_offer()
      |> Map.put(:pending_peers, MapSet.new())
    end
  end

  defp send_offer(%{pc: pc} = state) do
    {:ok, offer} = PeerConnection.create_offer(pc)
    Logger.info("Sending SDP offer for #{state.id}:\n#{String.slice(offer.sdp, 0, 200)}...")

    :ok = PeerConnection.set_local_description(pc, offer)

    result = PeerChannel.send_offer(state.channel, offer.sdp)
    Logger.info("PeerChannel.send_offer result for #{state.id}: #{inspect(result)}")

    state
  end

  defp log_first_rtp(peer_id, kind, peer_tracks) do
    key = {peer_id, kind, :first_rtp_logged}
    unless Process.get(key) do
      Process.put(key, true)
      Logger.info("Peer #{peer_id} first #{kind} RTP received — forwarding to #{map_size(peer_tracks)} subscriber(s): #{inspect(Map.keys(peer_tracks))}")
    end
  end

  defp broadcast_packet(peer_tracks, track_kind, packet) do
    peer_count = map_size(peer_tracks)

    if peer_count == 0 do
      # Logger.warning("broadcast_packet called but peer_tracks is EMPTY for #{track_kind}")
    end

    Enum.each(peer_tracks, fn {peer, tracks} ->
      track_id = Map.get(tracks, track_kind)

      if is_nil(track_id) do
        Logger.warning("No #{track_kind} track_id for peer #{peer}. Tracks: #{inspect(tracks)}")
      else
        PeerConnection.send_rtp(tracks.pc, track_id, packet)
      end
    end)

    :ok
  end
end
