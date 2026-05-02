defmodule Cura.Conversation.WhisperClient do
  require Logger

  @whisper_url "https://api.openai.com/v1/audio/transcriptions"

  @base_prompt "Consulta médica entre médico e paciente."

  def transcribe(audio_binary, prior_context \\ "")

  def transcribe(audio_binary, prior_context)
      when is_binary(audio_binary) and byte_size(audio_binary) > 0 do
    api_key = Application.fetch_env!(:cura, :openai_api_key)
    tmp_path = Path.join(System.tmp_dir!(), "audio_#{System.unique_integer([:positive])}.webm")

    File.write!(tmp_path, audio_binary)
    Logger.info("[Whisper] transcribing size=#{byte_size(audio_binary)}B")

    prompt =
      if prior_context != "" do
        "#{@base_prompt} #{prior_context}"
      else
        @base_prompt
      end

    try do
      multipart =
        {:multipart,
         [
           {:file, tmp_path, {"form-data", [name: "file", filename: "audio.webm"]},
            [{"Content-Type", "audio/webm"}]},
           {"model", "gpt-4o-transcribe"},
           {"language", "pt"},
           {"prompt", prompt}
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

  def transcribe(_, _), do: {:error, :empty_audio}
end
