defmodule Cura.Conversation.WhisperClient do
  require Logger

  @whisper_url "https://api.openai.com/v1/audio/transcriptions"

  # Whisper's `prompt` field biases the decoder toward the prompt's text. Feeding
  # the rolling transcript back in causes the model to re-emit recently-spoken
  # phrases when audio is silent or unclear, which surfaces on the UI as the
  # same sentence appearing several times. Keep the prompt to a static domain
  # hint with no transcribed words for it to echo.
  @base_prompt "Consulta médica entre médico e paciente."

  def transcribe(audio_binary)
      when is_binary(audio_binary) and byte_size(audio_binary) > 0 do
    api_key = Application.fetch_env!(:cura, :openai_api_key)
    tmp_path = Path.join(System.tmp_dir!(), "audio_#{System.unique_integer([:positive])}.webm")

    File.write!(tmp_path, audio_binary)
    Logger.info("[Whisper] transcribing size=#{byte_size(audio_binary)}B")

    try do
      multipart =
        {:multipart,
         [
           {:file, tmp_path, {"form-data", [name: "file", filename: "audio.webm"]},
            [{"Content-Type", "audio/webm"}]},
           {"model", "gpt-4o-transcribe"},
           {"language", "pt"},
           {"prompt", @base_prompt}
         ]}

      headers = [{"Authorization", "Bearer #{api_key}"}]

      case HTTPoison.post(@whisper_url, multipart, headers, recv_timeout: 120_000) do
        {:ok, %{status_code: 200, body: body}} ->
          text = body |> Jason.decode!() |> Map.fetch!("text") |> String.trim()

          if text == @base_prompt or text == "" do
            {:error, :empty_audio}
          else
            {:ok, text}
          end

        {:ok, %{status_code: status, body: body}} ->
          Logger.error("[Whisper] status=#{status} body=#{body}")
          {:error, :transcription_failed}

        {:error, reason} ->
          Logger.error("[Whisper] failed=#{inspect(reason)}")
          {:error, reason}
      end
    after
      File.rm(tmp_path)
    end
  end

  def transcribe(_), do: {:error, :empty_audio}
end
