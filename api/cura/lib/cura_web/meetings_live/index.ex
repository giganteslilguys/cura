defmodule CuraWeb.MeetingsLive.Index do
  use CuraWeb, :live_view
  require Logger

  alias Cura.Meetings

  def mount(%{"id" => room_id} = _params, _session, socket) do
    current_user = socket.assigns.current_user
    Logger.info("[MeetingsLive] mount — room_id=#{room_id} user=#{inspect(current_user && %{id: current_user.id, email: current_user.email, role: current_user.role})}")

    case Meetings.get_meeting!(room_id) do
      {:ok, meeting} ->
        if meeting.doctor_id == current_user.id or meeting.patient_id == current_user.id do
          if connected?(socket), do: schedule_timer_tick()

          {:ok,
           socket
           |> assign(:current_page, :calls)
           |> assign(:room_id, room_id)
           |> assign(:meeting, meeting)
           |> assign(:muted, true)
           |> assign(:video_enabled, true)
           |> assign(:connected, true)
           |> assign(:participants, [])
           |> assign(:call_duration, 0)
           |> assign(:call_started_at, DateTime.utc_now())
           |> assign(:show_settings, false)
           |> assign(:is_recording, false)
           |> assign(:recording_id, nil)
           |> assign(:transcript, [])
           |> assign(:ai_response, nil)
           |> assign(:suggested_questions, [])
           |> assign(:show_ai_panel, false)}
        else
          {:ok,
           socket
           |> put_flash(:error, "You are not authorized to join this meeting.")
           |> push_navigate(to: "/meetings")}
        end

      {:error, :not_found} ->
        {:ok,
         socket
         |> put_flash(:error, "Meeting not found.")
         |> push_navigate(to: "/meetings")}
    end
  end

  def mount(_params, _session, %{assigns: %{live_action: :redirect_to_default}} = socket) do
    {:ok, push_navigate(socket, to: "/meetings")}
  end

  def handle_event("toggle_mute", _params, socket) do
    new_muted = !socket.assigns.muted

    {:noreply, assign(socket, :muted, new_muted)}
  end

  def handle_event("toggle_video", _params, socket) do
    new_video_enabled = !socket.assigns.video_enabled

    {:noreply, assign(socket, :video_enabled, new_video_enabled)}
  end

  def handle_event("toggle_screen_share", _params, socket) do
    {:noreply, put_flash(socket, :info, "Screen sharing toggled")}
  end

  def handle_event("end_call", _params, socket) do
    {:noreply,
     socket
     |> assign(:connected, false)
     |> put_flash(:info, "Call ended")
     |> push_navigate(to: "/meetings")}
  end

  def handle_event("toggle_settings", _params, socket) do
    {:noreply, assign(socket, :show_settings, !socket.assigns.show_settings)}
  end

  def handle_event("retry_connection", _params, socket) do
    {:noreply,
     socket
     |> assign(:connected, true)
     |> assign(:call_started_at, DateTime.utc_now())
     |> assign(:call_duration, 0)
     |> put_flash(:info, "Reconnecting...")
     |> push_event("retry_connection", %{})}
  end

  def handle_event("change_audio_quality", %{"value" => quality}, socket) do
    # Implement audio quality change logic
    # For example: PeerChannel.set_audio_quality(socket.assigns.channel_pid, quality)

    {:noreply, put_flash(socket, :info, "Audio quality changed to #{quality}")}
  end

  def handle_event("change_video_quality", %{"value" => quality}, socket) do
    # Implement video quality change logic
    # For example: PeerChannel.set_video_quality(socket.assigns.channel_pid, quality)

    {:noreply, put_flash(socket, :info, "Video quality changed to #{quality}")}
  end

  def handle_event("toggle_notifications", _params, socket) do
    # Implement notification toggle logic

    {:noreply, put_flash(socket, :info, "Notification preferences updated")}
  end

  def handle_event("start_recording", _params, socket) do
    room_id = socket.assigns.room_id
    recording_id = "#{room_id}_#{System.system_time(:millisecond)}"
    recording_path = Path.join(System.tmp_dir!(), "recording_#{recording_id}.webm")

    {:noreply,
     socket
     |> assign(:is_recording, true)
     |> assign(:recording_id, recording_id)
     |> assign(:recording_path, recording_path)
     |> push_event("start_audio_recording", %{})
     |> put_flash(:info, "Recording started")}
  end

  def handle_event("stop_recording", _params, socket) do
    {:noreply,
     socket
     |> push_event("stop_audio_recording", %{})
     |> put_flash(:info, "Stopping recording...")}
  end



  def handle_event("toggle_ai_panel", _params, socket) do
    {:noreply, assign(socket, :show_ai_panel, !socket.assigns.show_ai_panel)}
  end


  def handle_info(:timer_tick, socket) do
    if socket.assigns.connected do
      call_started_at = socket.assigns.call_started_at
      duration = DateTime.diff(DateTime.utc_now(), call_started_at, :second)

      schedule_timer_tick()
      {:noreply, assign(socket, :call_duration, duration)}
    else
      {:noreply, socket}
    end
  end

  defp schedule_timer_tick do
    Process.send_after(self(), :timer_tick, 1000)
  end


  defp format_timestamp(timestamp_string) when is_binary(timestamp_string) do
    case DateTime.from_iso8601(timestamp_string) do
      {:ok, datetime, _} ->
        datetime
        |> DateTime.to_time()
        |> Time.to_string()
        |> String.slice(0..7)

      _ ->
        "00:00:00"
    end
  end

  defp format_timestamp(timestamp) when is_binary(timestamp) do
    case DateTime.from_iso8601(timestamp) do
      {:ok, dt, _offset} ->
        dt
        |> DateTime.to_time()
        |> Time.to_string()
        |> String.slice(0..7)

      _ ->
        "00:00:00"
    end
  end

  defp format_timestamp(_), do: "00:00:00"
end
