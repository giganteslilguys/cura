defmodule Cura.Meetings do
  @moduledoc """
  The Meetings context.
  """

  import Ecto.Query, warn: false
  alias Cura.Repo

  alias Cura.Meetings.DoctorAvailability
  alias Cura.Meetings.Meeting
  alias Cura.Meetings.TranscriptEntry

  def list_meetings do
    Repo.all(Meeting)
  end

  def list_meetings_for_user(user_id) do
    Repo.all(
      from m in Meeting,
        where: m.doctor_id == ^user_id or m.patient_id == ^user_id,
        order_by: [asc: m.date, asc: m.time],
        preload: [:doctor, patient: :patient_profile]
    )
  end

  def get_meeting_for_user!(id, user_id) do
    Repo.get_by!(Meeting, [id: id], or: [doctor_id: user_id, patient_id: user_id])
    |> Repo.preload([:doctor, patient: :patient_profile])
  end

  def get_meeting!(id) do
    case Repo.get(Meeting, id) do
      nil -> {:error, :not_found}
      meeting -> {:ok, Repo.preload(meeting, [:doctor, patient: :patient_profile])}
    end
  end

  def create_on_site_meeting(doctor_id, patient_email, title) do
    patient = Cura.Accounts.get_user_by_email(patient_email)

    unless patient && patient.role == :patient do
      {:error, :patient_not_found}
    else
      now = NaiveDateTime.utc_now()
      date = NaiveDateTime.to_date(now)
      time = now |> NaiveDateTime.to_time() |> Time.truncate(:second)

      create_meeting(%{
        "doctor_id" => doctor_id,
        "patient_id" => patient.id,
        "date" => Date.to_string(date),
        "time" => Time.to_string(time),
        "duration" => 30,
        "title" => title || "On-site Visit",
        "timezone" => "UTC",
        "kind" => "on_site"
      })
    end
  end

  def create_meeting(attrs \\ %{}) do
    %Meeting{}
    |> Meeting.changeset(attrs)
    |> Repo.insert()
  end

  def update_intake(%Meeting{} = meeting, attrs) do
    meeting
    |> Meeting.intake_changeset(attrs)
    |> Repo.update()
  end

  def update_notes(%Meeting{} = meeting, attrs) do
    meeting
    |> Meeting.notes_changeset(attrs)
    |> Repo.update()
  end

  def update_soap_note(%Meeting{} = meeting, attrs) do
    meeting
    |> Meeting.soap_note_changeset(attrs)
    |> Repo.update()
  end

  def complete_meeting(%Meeting{} = meeting) do
    meeting
    |> Ecto.Changeset.change(status: :completed)
    |> Repo.update()
    |> case do
      {:ok, updated} -> {:ok, Repo.preload(updated, [:doctor, patient: :patient_profile])}
      error -> error
    end
  end

  def update_meeting(%Meeting{} = meeting, attrs) do
    meeting
    |> Meeting.changeset(attrs)
    |> Repo.update()
  end

  def delete_meeting(%Meeting{} = meeting) do
    Repo.delete(meeting)
  end

  def change_meeting(%Meeting{} = meeting, attrs \\ %{}) do
    Meeting.changeset(meeting, attrs)
  end

  # ── Availability ────────────────────────────────────────────────────────────

  def list_availability(doctor_id) do
    Repo.all(
      from a in DoctorAvailability,
        where: a.doctor_id == ^doctor_id,
        order_by: [asc: a.day_of_week, asc: a.start_time]
    )
  end

  def create_availability(doctor_id, attrs) do
    %DoctorAvailability{}
    |> DoctorAvailability.changeset(Map.put(attrs, "doctor_id", doctor_id))
    |> Repo.insert()
  end

  def delete_availability(id, doctor_id) do
    case Repo.get(DoctorAvailability, id) do
      nil -> {:error, :not_found}
      %DoctorAvailability{doctor_id: ^doctor_id} = a -> Repo.delete(a)
      _ -> {:error, :unauthorized}
    end
  end

  @slot_duration 15
  @day_start {9, 0}
  @day_end {17, 0}

  def get_available_slots(doctor_id, %Date{} = date) do
    booked =
      Repo.all(
        from m in Meeting,
          where:
            m.doctor_id == ^doctor_id and m.date == ^date and
              m.status == :scheduled,
          select: m.time
      )
      |> MapSet.new()

    {start_h, start_m} = @day_start
    {end_h, end_m} = @day_end

    earliest = NaiveDateTime.add(NaiveDateTime.utc_now(), 12, :hour)

    generate_time_slots(
      Time.new!(start_h, start_m, 0),
      Time.new!(end_h, end_m, 0),
      @slot_duration
    )
    |> Enum.reject(&MapSet.member?(booked, &1))
    |> Enum.reject(fn slot_time ->
      slot_naive = NaiveDateTime.new!(date, slot_time)
      NaiveDateTime.compare(slot_naive, earliest) == :lt
    end)
    |> Enum.map(&%{time: &1, duration: @slot_duration})
  end

  defp generate_time_slots(start_time, end_time, duration_minutes) do
    start_min = start_time.hour * 60 + start_time.minute
    end_min = end_time.hour * 60 + end_time.minute

    start_min
    |> Stream.iterate(&(&1 + duration_minutes))
    |> Stream.take_while(fn t -> t + duration_minutes <= end_min end)
    |> Enum.map(fn minutes -> Time.new!(div(minutes, 60), rem(minutes, 60), 0) end)
  end

  def book_slot(
        patient_id,
        %{"doctor_id" => doctor_id, "date" => date_str, "time" => time_str} = attrs
      ) do
    normalized_time =
      case String.length(time_str) do
        5 -> time_str <> ":00"
        _ -> time_str
      end

    create_meeting(%{
      "doctor_id" => doctor_id,
      "patient_id" => patient_id,
      "date" => date_str,
      "time" => normalized_time,
      "duration" => @slot_duration,
      "title" => Map.get(attrs, "title", "Appointment"),
      "timezone" => "UTC"
    })
  end

  # ── Any-doctor slots ────────────────────────────────────────────────────────

  def get_any_available_slots(%Date{} = date) do
    Cura.Accounts.list_doctors()
    |> Enum.flat_map(fn doctor ->
      get_available_slots(doctor.id, date)
      |> Enum.map(&Map.put(&1, :doctor, doctor))
    end)
    |> Enum.sort_by(& &1.time)
  end

  # ── Reminders ────────────────────────────────────────────────────────────────

  def find_meetings_due_for_reminder(now) do
    in_24h = NaiveDateTime.add(now, 23 * 3600 + 30 * 60, :second)
    in_25h = NaiveDateTime.add(now, 25 * 3600, :second)
    in_1h = NaiveDateTime.add(now, 30 * 60, :second)
    in_2h = NaiveDateTime.add(now, 90 * 60, :second)

    all_scheduled =
      Repo.all(
        from m in Meeting,
          where: m.status == :scheduled,
          preload: [:doctor, patient: :patient_profile]
      )

    for m <- all_scheduled, reduce: [] do
      acc ->
        naive = NaiveDateTime.new!(m.date, m.time)

        cond do
          not m.reminder_24h_sent and
            NaiveDateTime.compare(naive, in_24h) == :gt and
              NaiveDateTime.compare(naive, in_25h) == :lt ->
            [{m, 24} | acc]

          not m.reminder_1h_sent and
            NaiveDateTime.compare(naive, in_1h) == :gt and
              NaiveDateTime.compare(naive, in_2h) == :lt ->
            [{m, 1} | acc]

          true ->
            acc
        end
    end
  end

  def mark_reminder_sent(%Meeting{} = meeting, 24) do
    meeting
    |> Ecto.Changeset.change(reminder_24h_sent: true)
    |> Repo.update()
  end

  def mark_reminder_sent(%Meeting{} = meeting, 1) do
    meeting
    |> Ecto.Changeset.change(reminder_1h_sent: true)
    |> Repo.update()
  end

  # ── AI SOAP generation ────────────────────────────────────────────────────────

  @openai_url "https://api.openai.com/v1/chat/completions"

  def generate_soap_note(meeting_id) do
    api_key = Application.fetch_env!(:cura, :openai_api_key)

    with {:ok, meeting} <- get_meeting!(meeting_id) do
      transcript = list_transcript_entries(meeting_id)

      transcript_text =
        if transcript == [] do
          nil
        else
          Enum.map_join(transcript, "\n", fn e ->
            "#{String.upcase(to_string(e.speaker))}: #{e.text}"
          end)
        end

      profile = meeting.patient && meeting.patient.patient_profile
      intake = meeting.patient_intake
      docs_ctx = build_documents_context(meeting.patient_id)

      patient_ctx = build_patient_context(profile, intake)

      transcript_section =
        if transcript_text do
          "CONSULTATION TRANSCRIPT:\n#{transcript_text}"
        else
          "TRANSCRIPT: Not available."
        end

      prompt = """
      You are a clinical documentation assistant. Based on the patient data, documents, and consultation below,
      generate a comprehensive structured visit note as a JSON object.

      #{patient_ctx}
      #{docs_ctx}

      #{transcript_section}

      Respond ONLY with a JSON object matching this exact schema (no prose, no markdown):
      {
        "vitals": null,
        "diagnoses": [{"condition": "string", "icd_code": "string or null", "type": "primary or secondary"}],
        "clinical_assessment": "string",
        "treatment_plan": ["string"],
        "prescriptions": [{"name": "string", "dosage": "string or null", "quantity": "string or null", "refills": "string or null", "instructions": "string or null"}],
        "lab_orders": ["string"],
        "follow_up_appointment": "string or null",
        "when_to_seek_care": ["string"]
      }
      """

      body = %{
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          %{
            role: "system",
            content: "You are a clinical documentation assistant. Output only valid JSON."
          },
          %{role: "user", content: prompt}
        ]
      }

      headers = [{"Authorization", "Bearer #{api_key}"}, {"Content-Type", "application/json"}]

      require Logger

      case Req.post(@openai_url, json: body, headers: headers, receive_timeout: 60_000) do
        {:ok, %{status: 200, body: %{"choices" => [%{"message" => %{"content" => content}} | _]}}} ->
          cleaned =
            content
            |> String.replace(~r/^```json\s*/m, "")
            |> String.replace(~r/```\s*$/m, "")
            |> String.trim()

          case Jason.decode(cleaned) do
            {:ok, note} -> {:ok, normalize_soap_note(note)}
            err ->
              Logger.error("[SOAP] JSON parse failed: #{inspect(err)}\nContent: #{content}")
              {:error, :parse_failed}
          end

        {:ok, %{status: status, body: body}} ->
          Logger.error("[SOAP] OpenAI returned #{status}: #{inspect(body)}")
          {:error, :openai_error}

        {:error, reason} ->
          Logger.error("[SOAP] Request failed: #{inspect(reason)}")
          {:error, :openai_error}
      end
    end
  end

  defp build_documents_context(nil), do: ""

  defp build_documents_context(patient_id) do
    docs = Cura.Documents.list_documents(patient_id)
    if docs == [], do: "", else: do_build_documents_context(docs)
  end

  defp do_build_documents_context(docs) do
    texts =
      docs
      |> Enum.map(fn doc ->
        path = Cura.Documents.full_path(doc)

        case System.cmd("pdftotext", [path, "-"], stderr_to_stdout: false) do
          {text, 0} ->
            trimmed = String.trim(text)
            if trimmed != "", do: "--- #{doc.filename} ---\n#{trimmed}", else: nil

          _ ->
            nil
        end
      end)
      |> Enum.reject(&is_nil/1)

    if texts == [] do
      ""
    else
      "\nPATIENT DOCUMENTS:\n" <> Enum.join(texts, "\n\n") <> "\n"
    end
  end

  defp medication_name(%{name: n}), do: n
  defp medication_name(%{"name" => n}), do: n
  defp medication_name(_), do: "unknown"

  defp allergy_substance(%{substance: s}), do: s
  defp allergy_substance(%{"substance" => s}), do: s
  defp allergy_substance(_), do: "unknown"

  defp build_patient_context(nil, nil), do: ""

  defp build_patient_context(profile, intake) do
    lines =
      if profile do
        meds = Enum.map_join(profile.medications || [], ", ", &medication_name/1)
        allergies = Enum.map_join(profile.allergies || [], ", ", &allergy_substance/1)
        conditions = Enum.join(profile.conditions || [], ", ")

        [
          "PATIENT DATA:",
          "- Medications: #{if meds == "", do: "none", else: meds}",
          "- Allergies: #{if allergies == "", do: "none", else: allergies}",
          "- Conditions: #{if conditions == "", do: "none", else: conditions}"
        ]
      else
        []
      end ++
        if intake do
          ["PRE-VISIT INTAKE:", "- Reason: #{intake["reason"]}"] ++
            if intake["symptoms"], do: ["- Symptoms: #{intake["symptoms"]}"], else: []
        else
          []
        end

    Enum.join(lines, "\n")
  end

  # ── Transcripts ─────────────────────────────────────────────────────────────

  def save_transcript_entry(meeting_id, speaker, text) do
    %TranscriptEntry{}
    |> TranscriptEntry.changeset(%{meeting_id: meeting_id, speaker: speaker, text: text})
    |> Repo.insert()
  end

  def list_transcript_entries(meeting_id) do
    Repo.all(
      from e in TranscriptEntry,
        where: e.meeting_id == ^meeting_id,
        order_by: [asc: e.inserted_at]
    )
  end

  # ── SOAP note normalisation ─────────────────────────────────────────────────
  #
  # GPT-4o-mini sometimes drifts from the requested schema: a diagnosis may
  # come back as `{"name": "..."}` instead of `{"condition": "..."}`, or with
  # a capitalised `type`. The frontend expects the canonical shape declared
  # in `lib/api/types.ts`, so we normalise here — anything else and the
  # diagnosis row renders blank.

  defp normalize_soap_note(note) when is_map(note) do
    note
    |> Map.update("diagnoses", [], &normalize_diagnoses/1)
    |> Map.update("prescriptions", [], &normalize_prescriptions/1)
  end

  defp normalize_soap_note(note), do: note

  defp normalize_diagnoses(list) when is_list(list) do
    list
    |> Enum.map(&normalize_diagnosis/1)
    |> Enum.reject(&(&1["condition"] in [nil, ""]))
  end

  defp normalize_diagnoses(_), do: []

  defp normalize_diagnosis(d) when is_map(d) do
    condition =
      d["condition"] || d["name"] || d["diagnosis"] || d["title"] || d["label"]

    type =
      case d["type"] do
        t when is_binary(t) ->
          case String.downcase(t) do
            "primary" -> "primary"
            "secondary" -> "secondary"
            _ -> "primary"
          end

        _ ->
          "primary"
      end

    %{
      "condition" => trim_or_nil(condition),
      "icd_code" => trim_or_nil(d["icd_code"] || d["code"] || d["icd"]),
      "type" => type
    }
  end

  defp normalize_diagnosis(_), do: %{"condition" => nil, "icd_code" => nil, "type" => "primary"}

  defp normalize_prescriptions(list) when is_list(list) do
    list
    |> Enum.map(&normalize_prescription/1)
    |> Enum.reject(&(&1["name"] in [nil, ""]))
  end

  defp normalize_prescriptions(_), do: []

  defp normalize_prescription(p) when is_map(p) do
    %{
      "name" => trim_or_nil(p["name"] || p["medication"] || p["drug"]),
      "dosage" => trim_or_nil(p["dosage"] || p["dose"]),
      "quantity" => trim_or_nil(p["quantity"] || p["qty"]),
      "refills" => trim_or_nil(p["refills"]),
      "instructions" => trim_or_nil(p["instructions"] || p["sig"])
    }
  end

  defp normalize_prescription(_),
    do: %{"name" => nil, "dosage" => nil, "quantity" => nil, "refills" => nil, "instructions" => nil}

  defp trim_or_nil(nil), do: nil
  defp trim_or_nil(v) when is_binary(v) do
    case String.trim(v) do
      "" -> nil
      trimmed -> trimmed
    end
  end
  defp trim_or_nil(v), do: v
end
