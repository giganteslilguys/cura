defmodule Cura.Conversation.ElevenLabsClient do
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

  @doc """
  Transcribes audio. Returns `{:ok, text}` by default.

  With `diarize: true`, returns `{:ok, [{speaker_id, text}]}` — a list of
  speaker-labelled segments in order of appearance. Designed for on-site
  meetings where multiple voices are captured by a single microphone.
  """
  def transcribe(audio_binary, opts \\ [])

  def transcribe(audio_binary, opts)
      when is_binary(audio_binary) and byte_size(audio_binary) > 0 do
    diarize = Keyword.get(opts, :diarize, false)
    Cura.Conversation.Semaphore.run(fn -> do_transcribe(audio_binary, diarize) end)
  end

  def transcribe(_, _), do: {:error, :empty_audio}

  defp do_transcribe(audio_binary, diarize) do
    api_key = Application.fetch_env!(:cura, :elevenlabs_api_key)
    tmp_path = Path.join(System.tmp_dir!(), "audio_#{System.unique_integer([:positive])}.webm")

    File.write!(tmp_path, audio_binary)

    Logger.info(
      "[ElevenLabs STT] transcribing size=#{byte_size(audio_binary)}B diarize=#{diarize}"
    )

    try do
      # tag_audio_events=false stops Scribe from emitting "(traffic sounds)",
      # "(mic adjustment)", "(cough)" and similar non-speech annotations. We
      # only want the spoken transcription.
      base_parts = [
        {:file, tmp_path, {"form-data", [name: "file", filename: "audio.webm"]},
         [{"Content-Type", "audio/webm"}]},
        {"model_id", @model},
        {"language_code", "pt"},
        {"tag_audio_events", "false"}
      ]

      parts = if diarize, do: base_parts ++ [{"diarize", "true"}], else: base_parts
      multipart = {:multipart, parts}
      headers = [{"xi-api-key", api_key}]

      case HTTPoison.post(@url, multipart, headers, recv_timeout: 120_000) do
        {:ok, %{status_code: 200, body: body}} ->
          decoded = Jason.decode!(body)

          if diarize do
            extract_diarized_segments(decoded)
          else
            raw = decoded |> Map.fetch!("text") |> String.trim()
            text = strip_audio_events(raw)
            hallucination? = Enum.any?(@hallucinations, &String.contains?(text, &1))

            if text == "" or String.length(text) < 3 or hallucination? do
              if hallucination?,
                do: Logger.info("[ElevenLabs STT] dropped hallucination: #{text}")

              {:error, :empty_audio}
            else
              {:ok, text}
            end
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

  # Groups the word-level diarization output into contiguous per-speaker
  # segments, filters hallucinations, and returns them in order.
  defp extract_diarized_segments(%{"words" => words}) do
    segments =
      words
      |> Enum.filter(&(&1["type"] == "word"))
      |> Enum.chunk_by(& &1["speaker_id"])
      |> Enum.map(fn chunk ->
        speaker = hd(chunk)["speaker_id"]
        text = chunk |> Enum.map_join(" ", & &1["text"]) |> strip_audio_events()
        {speaker, text}
      end)
      |> Enum.reject(fn {_speaker, text} ->
        hallucination? = Enum.any?(@hallucinations, &String.contains?(text, &1))
        text == "" or String.length(text) < 3 or hallucination?
      end)

    if segments == [], do: {:error, :empty_audio}, else: {:ok, segments}
  end

  defp extract_diarized_segments(_), do: {:error, :empty_audio}

  # Defense-in-depth: even with tag_audio_events=false, strip anything
  # wrapped in (...) or [...] from the transcription. Spoken Portuguese
  # never produces parentheticals — they're always a transcription
  # convention for non-speech events. Collapses extra whitespace left
  # behind by the strip.
  defp strip_audio_events(text) do
    text
    |> String.replace(~r/\([^)]*\)/u, "")
    |> String.replace(~r/\[[^\]]*\]/u, "")
    |> String.replace(~r/\s+/u, " ")
    |> String.trim()
  end
end
