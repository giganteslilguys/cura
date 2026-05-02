defmodule CuraWeb.ConversationChannel do
  use Phoenix.Channel

  require Logger

  alias Cura.Conversation.GeminiClient
  alias Cura.Conversation.RoomStore
  alias Cura.Conversation.WhisperClient

  @impl true
  def join("conversation:" <> room_id, _params, socket) do
    {:ok, assign(socket, :room_id, room_id)}
  end

  @impl true
  def handle_in("audio_chunk", %{"audio" => base64_audio}, socket) do
    room_id = socket.assigns.room_id

    prior_context = RoomStore.get_context(room_id)

    with {:ok, audio_binary} <- Base.decode64(base64_audio),
         {:ok, text} <- WhisperClient.transcribe(audio_binary, prior_context),
         false <- text == socket.assigns[:last_transcript] do
      Logger.info("[Channel] room=#{room_id} transcribed=\"#{text}\"")

      broadcast!(socket, "transcript_update", %{
        text: text,
        timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
      })

      case RoomStore.append_chunk(room_id, text) do
        {:trigger, transcript, order_id} ->
          Logger.info("[Channel] room=#{room_id} triggering Gemini order=#{order_id}")
          GeminiClient.call_async(transcript, room_id, order_id)

        :noop ->
          :ok
      end

      {:noreply, assign(socket, :last_transcript, text)}
    else
      true ->
        Logger.info("[Channel] room=#{room_id} duplicate transcript, skipping")
        {:noreply, socket}

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
