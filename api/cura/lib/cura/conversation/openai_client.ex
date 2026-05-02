defmodule Cura.Conversation.OpenAIClient do
  @moduledoc """
  Real-time clinical decision support. On each conversation tick the channel
  hands us the rolling transcript + every suggestion already shown to the
  doctor; we bundle that with the patient's profile and pre-visit intake,
  ask OpenAI for *new* suggestions only, dedupe defensively against the
  prior list, broadcast to the room, and write the survivors back to
  `RoomStore` so the next tick sees them too.
  """

  require Logger

  alias Cura.Accounts.PatientProfile
  alias Cura.Conversation.RoomStore
  alias Cura.Meetings

  @openai_url "https://api.openai.com/v1/chat/completions"
  @model "gpt-4o-mini"

  # Instructions are in English so the model treats them as guidance, but
  # the *generated* `text` and `rationale` fields must be written in
  # Portuguese (Portugal). JSON keys and enum values (type/priority) stay
  # in English — they are part of the response contract.
  @system_prompt """
  You are a clinical decision support assistant helping a doctor during a live consultation in Portugal.
  Based on the patient's profile, their pre-consultation intake, the live transcript so far,
  and the suggestions you have already provided in this consultation, surface 1-4 NEW
  high-value items for the doctor to consider next.

  Each item must be one of:
  - "question" — something specific to ask the patient
  - "action"   — a clinical step to take or recommend (test, exam, referral, prescription change)
  - "flag"     — a safety concern, drug interaction, or red flag to highlight

  Hard rules:
  - WRITE the "text" and "rationale" fields in EUROPEAN PORTUGUESE (português de Portugal),
    not Brazilian. Use European spelling and phrasing — e.g. "está", "telemóvel", "casa de banho",
    "obrigado/a", "deve", "comprimido". Avoid Brazilianisms like "você", "celular", gerúndios
    como "estou fazendo" — prefer "está a fazer".
  - The "type" and "priority" values stay in English (they are enum values).
  - DO NOT repeat or paraphrase any item already in "Previously suggested".
  - DO NOT suggest topics already explored in the transcript.
  - DO NOT produce generic advice (e.g. "perguntar sobre estilo de vida"). Be grounded in this patient's data.
  - If you have nothing genuinely new and useful, return an empty array.
  - Each "text" must be in the doctor's perspective and imperative — e.g. "Pergunte sobre ...",
    "Solicite ...", "Verifique ...", "Atenção a ...".
  - Each "rationale" must be a single short sentence in Portuguese tying the item to the patient's data or transcript.
  - Output must conform to the response schema; do not wrap it in prose or code fences.
  """

  def suggest_async(meeting_id, transcript, prior_suggestions, order_id) do
    Task.start(fn -> suggest(meeting_id, transcript, prior_suggestions, order_id) end)
  end

  defp suggest(meeting_id, transcript, prior_suggestions, order_id) do
    api_key = Application.fetch_env!(:cura, :openai_api_key)
    started_at = System.monotonic_time(:millisecond)

    with {:ok, meeting} <- Meetings.get_meeting!(meeting_id),
         :ok <- log_start(meeting, meeting_id, order_id, transcript, prior_suggestions),
         user_content = build_user_content(meeting, transcript, prior_suggestions),
         {:ok, items} <- call_openai(api_key, user_content) do
      new_items = items |> dedupe(prior_suggestions) |> Enum.map(&assign_id/1)
      took_ms = System.monotonic_time(:millisecond) - started_at
      dropped = length(items) - length(new_items)

      cond do
        new_items != [] ->
          RoomStore.add_suggestions(meeting_id, new_items)

          CuraWeb.Endpoint.broadcast("conversation:#{meeting_id}", "suggestions_update", %{
            suggestions: new_items,
            order_id: order_id
          })

          Logger.info(
            "[OpenAI] room=#{meeting_id} order=#{order_id} broadcast=#{length(new_items)} dedup_dropped=#{dropped} took_ms=#{took_ms}"
          )

          Enum.each(new_items, fn item ->
            Logger.info(
              "[OpenAI] room=#{meeting_id} order=#{order_id} NEW [#{item["type"]}/#{item["priority"]}] #{inspect(item["text"])} — #{inspect(item["rationale"])}"
            )
          end)

        items == [] ->
          Logger.info(
            "[OpenAI] room=#{meeting_id} order=#{order_id} model returned no suggestions took_ms=#{took_ms}"
          )

        true ->
          Logger.info(
            "[OpenAI] room=#{meeting_id} order=#{order_id} all #{length(items)} items deduped, nothing to broadcast took_ms=#{took_ms}"
          )
      end

      {:ok, new_items}
    else
      error ->
        took_ms = System.monotonic_time(:millisecond) - started_at

        Logger.error(
          "[OpenAI] room=#{meeting_id} order=#{order_id} failed=#{inspect(error)} took_ms=#{took_ms}"
        )

        error
    end
  end

  defp log_start(meeting, meeting_id, order_id, transcript, prior_suggestions) do
    patient = meeting.patient
    profile = patient && patient.patient_profile
    name = if patient, do: "#{patient.first_name} #{patient.last_name}", else: "(unknown)"

    summary =
      if is_struct(profile, PatientProfile) do
        age = if profile.date_of_birth, do: years_since(profile.date_of_birth), else: "?"
        bmi = PatientProfile.bmi(profile) || "?"

        "age=#{age} sex=#{profile.sex || "?"} bmi=#{bmi} conditions=#{length(profile.conditions)} meds=#{length(profile.medications)} allergies=#{length(profile.allergies)}"
      else
        "no_profile"
      end

    intake_reason =
      case meeting.patient_intake do
        %{} = m -> intake_field(m, "reason") || "?"
        _ -> "?"
      end

    Logger.info(
      "[OpenAI] room=#{meeting_id} order=#{order_id} starting transcript_chars=#{String.length(to_string(transcript))} prior=#{length(prior_suggestions)} patient=#{inspect(name)} #{summary} reason=#{inspect(intake_reason)}"
    )

    :ok
  end

  defp call_openai(api_key, user_content) do
    body = %{
      model: @model,
      messages: [
        %{role: "system", content: @system_prompt},
        %{role: "user", content: user_content}
      ],
      response_format: %{
        type: "json_schema",
        json_schema: %{
          name: "clinical_suggestions",
          strict: true,
          schema: response_schema()
        }
      },
      temperature: 0.4
    }

    headers = [{"authorization", "Bearer #{api_key}"}]

    case Req.post(@openai_url, json: body, headers: headers, receive_timeout: 30_000) do
      {:ok, %{status: 200, body: response}} ->
        parse_response(response)

      {:ok, %{status: status, body: response}} ->
        Logger.error("[OpenAI] status=#{status} body=#{inspect(response)}")
        {:error, {:bad_status, status}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp parse_response(response) do
    text =
      get_in(response, ["choices", Access.at(0), "message", "content"])

    with text when is_binary(text) <- text,
         {:ok, %{"items" => items}} when is_list(items) <- Jason.decode(text) do
      valid = Enum.filter(items, &valid_item?/1)
      invalid = length(items) - length(valid)

      if invalid > 0 do
        Logger.warning("[OpenAI] dropped #{invalid} malformed item(s) from response")
      end

      {:ok, valid}
    else
      _ ->
        Logger.error("[OpenAI] could not parse response text=#{inspect(text)}")
        {:error, :invalid_response}
    end
  end

  defp valid_item?(%{"type" => t, "text" => x, "rationale" => r, "priority" => p})
       when t in ["question", "action", "flag"] and
              p in ["high", "medium", "low"] and
              is_binary(x) and is_binary(r) do
    String.length(String.trim(x)) > 0
  end

  defp valid_item?(_), do: false

  defp dedupe(items, prior) do
    seen = MapSet.new(prior, &normalize_text/1)
    Enum.reject(items, fn item -> MapSet.member?(seen, normalize_text(item)) end)
  end

  defp normalize_text(item) do
    text =
      case item do
        %{"text" => t} -> t
        %{text: t} -> t
        _ -> ""
      end

    text |> String.downcase() |> String.replace(~r/\s+/, " ") |> String.trim()
  end

  defp assign_id(item), do: Map.put(item, "id", Ecto.UUID.generate())

  # OpenAI structured outputs require the top-level schema to be an object,
  # so we wrap the array of suggestions under an "items" key. `strict: true`
  # also requires `additionalProperties: false` on every object and every
  # property listed in `required`.
  defp response_schema do
    %{
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: %{
        items: %{
          type: "array",
          items: %{
            type: "object",
            additionalProperties: false,
            required: ["type", "text", "rationale", "priority"],
            properties: %{
              type: %{type: "string", enum: ["question", "action", "flag"]},
              text: %{type: "string"},
              rationale: %{type: "string"},
              priority: %{type: "string", enum: ["high", "medium", "low"]}
            }
          }
        }
      }
    }
  end

  defp build_user_content(meeting, transcript, prior_suggestions) do
    """
    PATIENT PROFILE
    #{summarize_patient(meeting.patient)}

    PRE-CONSULTATION INTAKE
    #{summarize_intake(meeting.patient_intake)}

    TRANSCRIPT SO FAR
    #{transcript |> to_string() |> String.trim() |> empty_or("(no transcript yet)")}

    PREVIOUSLY SUGGESTED (do NOT repeat any of these)
    #{summarize_prior(prior_suggestions)}
    """
  end

  defp summarize_patient(nil), do: "(unknown)"

  defp summarize_patient(patient) do
    profile = patient.patient_profile
    has_profile = is_struct(profile, PatientProfile)

    sex = if has_profile, do: profile.sex || "unknown", else: "unknown"

    age =
      if has_profile && profile.date_of_birth,
        do: years_since(profile.date_of_birth),
        else: "unknown"

    bmi = if has_profile, do: PatientProfile.bmi(profile) || "unknown", else: "unknown"
    height = if has_profile, do: profile.height_cm || "?", else: "?"
    weight = if has_profile, do: profile.weight_kg || "?", else: "?"

    meds =
      if has_profile,
        do: profile.medications |> Enum.map_join("; ", &medication_str/1),
        else: ""

    allergies =
      if has_profile,
        do: profile.allergies |> Enum.map_join("; ", &allergy_str/1),
        else: ""

    conditions = if has_profile, do: Enum.join(profile.conditions, ", "), else: ""

    """
    - Name: #{patient.first_name} #{patient.last_name}
    - Sex: #{sex}, Age: #{age}
    - Height/Weight/BMI: #{height} cm / #{weight} kg / #{bmi}
    - Conditions: #{empty_or(conditions, "none reported")}
    - Medications: #{empty_or(meds, "none reported")}
    - Allergies: #{empty_or(allergies, "none reported")}
    """
  end

  defp years_since(%Date{} = dob) do
    today = Date.utc_today()
    age = today.year - dob.year
    if {today.month, today.day} < {dob.month, dob.day}, do: age - 1, else: age
  end

  defp medication_str(med) do
    [med.name, med.dose, med.frequency]
    |> Enum.reject(&(is_nil(&1) or &1 == ""))
    |> Enum.join(" ")
  end

  defp allergy_str(a), do: "#{a.substance} (#{a.severity})"

  defp empty_or(value, default) when value in [nil, ""], do: default
  defp empty_or(value, _default), do: value

  defp summarize_intake(nil), do: "(no intake provided)"

  defp summarize_intake(intake) when is_map(intake) do
    reason = intake_field(intake, "reason") || "(not provided)"
    symptoms = intake_field(intake, "symptoms")
    notes = intake_field(intake, "notes")

    [
      "- Reason: #{reason}",
      symptoms && "- Symptoms: #{symptoms}",
      notes && "- Notes: #{notes}"
    ]
    |> Enum.reject(&is_nil/1)
    |> Enum.join("\n")
  end

  # patient_intake is stored as a JSONB :map field — keys come back as strings
  # on read, but recently-cast values may still have atom keys. Try both.
  defp intake_field(map, key) do
    Map.get(map, key) || Map.get(map, String.to_existing_atom(key))
  rescue
    ArgumentError -> Map.get(map, key)
  end

  defp summarize_prior([]), do: "(none yet)"

  defp summarize_prior(suggestions) do
    suggestions
    |> Enum.map(fn s ->
      text = Map.get(s, "text") || Map.get(s, :text) || ""
      type = Map.get(s, "type") || Map.get(s, :type) || ""
      "- [#{type}] #{text}"
    end)
    |> Enum.join("\n")
  end
end
