defmodule Cura.Conversation.WhisperClient do
  require Logger

  @whisper_url "https://api.openai.com/v1/audio/transcriptions"
  @model "gpt-4o-transcribe"

  @hallucinations [
    "Bom dia, Sr. Silva. O que o traz aqui hoje?",
    "Obrigado por assistir.",
    "Até à próxima.",
    "Inscreva-se no canal.",
    "Legendas por",
    "Transcrição por"
  ]

  @base_prompt "Transcrição de consulta médica em português europeu. " <>
                 "Intervenientes: médico e paciente. " <>
                 "Vocabulário esperado: sintomas, diagnósticos, medicamentos, exames, dores, tensão arterial, análises, receita, historial clínico."

  def transcribe(audio_binary, _prior_context \\ "")

  def transcribe(audio_binary, _prior_context)
      when is_binary(audio_binary) and byte_size(audio_binary) > 0 do
    api_key = Application.fetch_env!(:cura, :openai_api_key)
    tmp_path = Path.join(System.tmp_dir!(), "audio_#{System.unique_integer([:positive])}.webm")

    File.write!(tmp_path, audio_binary)
    Logger.info("[Whisper] transcribing size=#{byte_size(audio_binary)}B")

    prompt = @base_prompt

    try do
      multipart =
        {:multipart,
         [
           {:file, tmp_path, {"form-data", [name: "file", filename: "audio.webm"]},
            [{"Content-Type", "audio/webm"}]},
           {"model", @model},
           {"language", "pt"},
           {"prompt", prompt},
           {"temperature", "0"}
         ]}

      headers = [{"Authorization", "Bearer #{api_key}"}]

      case HTTPoison.post(@whisper_url, multipart, headers, recv_timeout: 120_000) do
        {:ok, %{status_code: 200, body: body}} ->
          text = body |> Jason.decode!() |> Map.fetch!("text") |> String.trim()

          hallucination? = Enum.any?(@hallucinations, &String.contains?(text, &1))

          if text == "" or String.length(text) < 3 or hallucination? do
            if hallucination?, do: Logger.info("[Whisper] dropped hallucination: #{text}")
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
