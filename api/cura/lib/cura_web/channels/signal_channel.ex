defmodule CuraWeb.SignalChannel do
  @moduledoc """
  Dumb signalling relay for 1:1 peer-to-peer WebRTC.

  Two clients (the meeting's doctor and patient) join `room:<meeting_id>`.
  Anything one sends as a `signal` event is broadcast to the other,
  with the sender's user id attached. We don't parse SDP, we don't
  mangle ICE — Phoenix is a postbox, the browsers do the WebRTC.
  """

  use CuraWeb, :channel
  require Logger

  alias CuraWeb.Presence

  @impl true
  def join("room:" <> meeting_id, _payload, socket) do
    user = socket.assigns.current_user

    case Cura.Meetings.get_meeting!(meeting_id) do
      {:ok, meeting} ->
        if meeting.doctor_id == user.id or meeting.patient_id == user.id do
          send(self(), :after_join)
          {:ok, %{user_id: user.id}, assign(socket, :meeting_id, meeting_id)}
        else
          {:error, %{reason: "unauthorized"}}
        end

      _ ->
        {:error, %{reason: "not_found"}}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    user = socket.assigns.current_user

    {:ok, _ref} =
      Presence.track(socket, user.id, %{
        user_id: user.id,
        joined_at: System.system_time(:millisecond)
      })

    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  @impl true
  def handle_in("signal", payload, socket) do
    payload = Map.put(payload, "from", socket.assigns.current_user.id)
    broadcast_from!(socket, "signal", payload)
    {:noreply, socket}
  end
end
