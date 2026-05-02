defmodule Cura.Conversation.WhisperClient do
  require Logger

  @url "https://api.elevenlabs.io/v1/speech-to-text"
  @model "scribe_v1"

  @hallucinations [
    "Bom dia, Sr. Silva. O que o traz aqui hoje?",
    "Obrigado por assistir.",
    "Até à próxima.",
    "Inscreva-se no canal.",
    "Legendas por",
    "Transcrição por"
  ]

  def transcribe(audio_binary)
      when is_binary(audio_binary) and byte_size(audio_binary) > 0 do
    Cura.Conversation.Semaphore.run(fn -> do_transcribe(audio_binary) end)
  end

  defp do_transcribe(audio_binary) do
    api_key = Application.fetch_env!(:cura, :elevenlabs_api_key)
    tmp_path = Path.join(System.tmp_dir!(), "audio_#{System.unique_integer([:positive])}.webm")

    File.write!(tmp_path, audio_binary)
    Logger.info("[ElevenLabs STT] transcribing size=#{byte_size(audio_binary)}B")

    try do
      multipart =
        {:multipart,
         [
           {:file, tmp_path, {"form-data", [name: "file", filename: "audio.webm"]},
            [{"Content-Type", "audio/webm"}]},
           {"model_id", @model},
           {"language_code", "pt"}
         ]}

      headers = [{"xi-api-key", api_key}]

      case HTTPoison.post(@url, multipart, headers, recv_timeout: 120_000) do
        {:ok, %{status_code: 200, body: body}} ->
          text = body |> Jason.decode!() |> Map.fetch!("text") |> String.trim()

          hallucination? = Enum.any?(@hallucinations, &String.contains?(text, &1))

          if text == "" or String.length(text) < 3 or hallucination? do
            if hallucination?, do: Logger.info("[ElevenLabs STT] dropped hallucination: #{text}")
            {:error, :empty_audio}
          else
            {:ok, text}
          end

        {:ok, %{status_code: status, body: body}} ->
          Logger.error("[ElevenLabs STT] status=#{status} body=#{body}")
          {:error, :transcription_failed}

        {:error, reason} ->
          Logger.error("[ElevenLabs STT] failed=#{inspect(reason)}")
          {:error, reason}
      end
    after
      File.rm(tmp_path)
    end
  end

  def transcribe(_), do: {:error, :empty_audio}
end
