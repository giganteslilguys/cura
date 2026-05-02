defmodule CuraWeb.ConversationChannel do
  use Phoenix.Channel

  require Logger

  alias Cura.Conversation.GeminiClient
  alias Cura.Conversation.RoomStore
  alias Cura.Conversation.WhisperClient
  alias Cura.Meetings

  @impl true
  def join("conversation:" <> room_id, _params, socket) do
    {:ok, assign(socket, :room_id, room_id)}
  end

  @impl true
  def handle_in("audio_chunk", %{"audio" => base64_audio}, socket) do
    room_id = socket.assigns.room_id

    with {:ok, audio_binary} <- Base.decode64(base64_audio),
         {:ok, text} <- WhisperClient.transcribe(audio_binary) do
      case RoomStore.append_chunk(room_id, text) do
        :duplicate ->
          Logger.info("[Channel] room=#{room_id} duplicate transcript, skipping")

        result ->
          speaker = socket.assigns.current_user.role
          Logger.info("[Channel] room=#{room_id} speaker=#{speaker} transcribed=\"#{text}\"")

          broadcast!(socket, "transcript_update", %{
            text: text,
            speaker: speaker,
            timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
          })

          case Meetings.save_transcript_entry(room_id, speaker, text) do
            {:error, reason} ->
              Logger.error("[Channel] failed to save transcript entry: #{inspect(reason)}")

            _ ->
              :ok
          end

          case result do
            {:trigger, transcript, prior_suggestions, order_id} ->
              Logger.info("[Channel] room=#{room_id} triggering Gemini order=#{order_id}")
              GeminiClient.suggest_async(room_id, transcript, prior_suggestions, order_id)

            :noop ->
              :ok
          end
      end

      {:noreply, socket}
    else
      :error ->
        Logger.error("[ConversationChannel] room=#{room_id} invalid base64 audio")
        {:noreply, socket}

      {:error, reason} ->
        Logger.error(
          "[ConversationChannel] room=#{room_id} transcription failed=#{inspect(reason)}"
        )
        {:noreply, socket}
    end
  end
end
