defmodule Cura.Emails do
  import Swoosh.Email

  alias Cura.Mailer

  @from {"Cura Health", "noreply@cura.health"}

  # ── Public dispatch (fire-and-forget) ────────────────────────────────────────

  def send_booking_confirmations(meeting) do
    Task.start(fn ->
      if meeting.patient, do: Mailer.deliver(booking_patient(meeting))
      if meeting.doctor, do: Mailer.deliver(booking_doctor(meeting))
    end)
  end

  def send_reminders(meeting) do
    Task.start(fn ->
      if meeting.patient, do: Mailer.deliver(reminder(meeting, :patient))
      if meeting.doctor, do: Mailer.deliver(reminder(meeting, :doctor))
    end)
  end

  def send_visit_summary(meeting) do
    Task.start(fn ->
      if meeting.patient, do: Mailer.deliver(visit_summary(meeting))
    end)
  end

  # ── Email constructors ────────────────────────────────────────────────────────

  defp booking_patient(meeting) do
    patient = meeting.patient
    doctor = meeting.doctor

    new()
    |> to({full_name(patient), patient.email})
    |> from(@from)
    |> subject("Consulta confirmada — #{fmt_date(meeting.date)} com Dr. #{doctor.last_name}")
    |> html_body(
      wrap("""
        <h1 style="#{h1()}">A sua consulta está confirmada</h1>
        <p style="#{p()}">Olá #{patient.first_name}, a sua consulta foi agendada.</p>
        #{detail_table([{"Médico/a", "Dr. #{full_name(doctor)}"}, {"Data", fmt_date(meeting.date)}, {"Hora", fmt_time(meeting.time)}, {"Duração", "#{meeting.duration} minutos"}])}
        <p style="#{p()} margin-top:24px;">Por favor, preencha o formulário pré-consulta antes da consulta para que o seu médico/a possa preparar-se.</p>
        #{cta("Entrar na consulta", "http://localhost:3000/meetings")}
      """)
    )
  end

  defp booking_doctor(meeting) do
    doctor = meeting.doctor
    patient = meeting.patient

    new()
    |> to({full_name(doctor), doctor.email})
    |> from(@from)
    |> subject("New appointment — #{fmt_date(meeting.date)} with #{full_name(patient)}")
    |> html_body(
      wrap("""
        <h1 style="#{h1()}">New appointment booked</h1>
        <p style="#{p()}">Hi Dr. #{doctor.last_name}, a patient has scheduled a visit with you.</p>
        #{detail_table([{"Patient", full_name(patient)}, {"Date", fmt_date(meeting.date)}, {"Time", fmt_time(meeting.time)}, {"Duration", "#{meeting.duration} minutes"}])}
        #{cta("View patient details", "http://localhost:3000/meetings")}
      """)
    )
  end

  defp reminder(meeting, :patient) do
    patient = meeting.patient
    doctor = meeting.doctor

    new()
    |> to({full_name(patient), patient.email})
    |> from(@from)
    |> subject(
      "Reminder: appointment tomorrow at #{fmt_time(meeting.time)} with Dr. #{doctor.last_name}"
    )
    |> html_body(
      wrap("""
        <h1 style="#{h1()}">Your appointment is tomorrow</h1>
        <p style="#{p()}">Hi #{patient.first_name}, just a reminder about your upcoming visit.</p>
        #{detail_table([{"Doctor", "Dr. #{full_name(doctor)}"}, {"Date", fmt_date(meeting.date)}, {"Time", fmt_time(meeting.time)}])}
        #{cta("Join your visit", "http://localhost:3000/meetings")}
      """)
    )
  end

  defp reminder(meeting, :doctor) do
    doctor = meeting.doctor
    patient = meeting.patient

    new()
    |> to({full_name(doctor), doctor.email})
    |> from(@from)
    |> subject(
      "Reminder: appointment tomorrow with #{full_name(patient)} at #{fmt_time(meeting.time)}"
    )
    |> html_body(
      wrap("""
        <h1 style="#{h1()}">Appointment reminder</h1>
        <p style="#{p()}">Hi Dr. #{doctor.last_name}, you have a consultation scheduled for tomorrow.</p>
        #{detail_table([{"Patient", full_name(patient)}, {"Date", fmt_date(meeting.date)}, {"Time", fmt_time(meeting.time)}])}
        #{cta("View patient details", "http://localhost:3000/meetings")}
      """)
    )
  end

  defp visit_summary(meeting) do
    patient = meeting.patient
    doctor = meeting.doctor
    soap = meeting.soap_note || %{}

    diagnoses = Map.get(soap, "diagnoses", [])
    prescriptions = Map.get(soap, "prescriptions", [])
    treatment = Map.get(soap, "treatment_plan", [])
    follow_up = Map.get(soap, "follow_up_appointment")
    seek_care = Map.get(soap, "when_to_seek_care", [])
    assessment = Map.get(soap, "clinical_assessment")

    sections =
      [
        if(assessment, do: summary_section("Clinical Assessment", assessment_html(assessment))),
        if(diagnoses != [], do: summary_section("Diagnoses", diagnoses_html(diagnoses))),
        if(treatment != [], do: summary_section("Treatment Plan", checklist_html(treatment))),
        if(prescriptions != [],
          do: summary_section("Prescriptions", prescriptions_html(prescriptions))
        ),
        if(follow_up, do: summary_section("Follow-up", follow_up_html(follow_up))),
        if(seek_care != [],
          do: summary_section("When to Seek Immediate Care", seek_care_html(seek_care))
        )
      ]
      |> Enum.filter(& &1)
      |> Enum.join("\n")

    new()
    |> to({full_name(patient), patient.email})
    |> from(@from)
    |> subject("Your visit summary — #{fmt_date(meeting.date)}")
    |> html_body(wrap_summary(patient, doctor, meeting, sections))
  end

  defp wrap_summary(patient, doctor, meeting, sections) do
    """
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
    <body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:40px 16px;">
        <tr><td align="center">
          <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

            <!-- Logo row -->
            <tr>
              <td style="padding-bottom:20px;">
                <span style="font-size:19px;font-weight:700;color:#b5471b;letter-spacing:-0.5px;">cura</span>
              </td>
            </tr>

            <!-- Header card -->
            <tr>
              <td style="background:#fff;border-radius:16px 16px 0 0;padding:28px 32px 24px;border:1px solid rgba(0,0,0,0.07);border-bottom:none;">
                <p style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#b5471b;margin:0 0 10px;">Visit Summary</p>
                <h1 style="font-size:21px;font-weight:700;color:#111;margin:0 0 6px;letter-spacing:-0.3px;">
                  #{fmt_date(meeting.date)}
                </h1>
                <p style="font-size:14px;color:#888;margin:0;">
                  Hi #{patient.first_name} — here's what was discussed and decided during your consultation.
                </p>

                <!-- Visit meta row -->
                <table cellpadding="0" cellspacing="0" style="margin-top:20px;width:100%;background:#faf9f7;border-radius:10px;border:1px solid rgba(0,0,0,0.06);">
                  <tr>
                    <td style="padding:10px 16px;border-right:1px solid rgba(0,0,0,0.06);">
                      <p style="font-size:11px;color:#aaa;margin:0 0 2px;text-transform:uppercase;letter-spacing:0.06em;">Doctor</p>
                      <p style="font-size:13px;font-weight:600;color:#222;margin:0;">Dr. #{full_name(doctor)}</p>
                    </td>
                    <td style="padding:10px 16px;border-right:1px solid rgba(0,0,0,0.06);">
                      <p style="font-size:11px;color:#aaa;margin:0 0 2px;text-transform:uppercase;letter-spacing:0.06em;">Date</p>
                      <p style="font-size:13px;font-weight:600;color:#222;margin:0;">#{fmt_date(meeting.date)}</p>
                    </td>
                    <td style="padding:10px 16px;">
                      <p style="font-size:11px;color:#aaa;margin:0 0 2px;text-transform:uppercase;letter-spacing:0.06em;">Time</p>
                      <p style="font-size:13px;font-weight:600;color:#222;margin:0;">#{fmt_time(meeting.time)}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Divider -->
            <tr>
              <td style="height:1px;background:rgba(0,0,0,0.06);"></td>
            </tr>

            <!-- Sections -->
            #{sections}

            <!-- Footer card bottom -->
            <tr>
              <td style="background:#fff;border-radius:0 0 16px 16px;padding:20px 32px 28px;border:1px solid rgba(0,0,0,0.07);border-top:none;">
                <div style="text-align:center;margin-bottom:20px;">
                  <a href="http://localhost:3000/meetings/#{meeting.id}/summary"
                     style="display:inline-block;padding:11px 26px;background:#b5471b;color:#fff;text-decoration:none;border-radius:999px;font-size:13px;font-weight:600;">
                    View full summary
                  </a>
                </div>
                <p style="font-size:12px;color:#bbb;text-align:center;margin:0;line-height:1.5;">
                  Cura Health &nbsp;·&nbsp; If you have questions, contact your doctor through the platform.
                </p>
              </td>
            </tr>

            <!-- Email footer -->
            <tr>
              <td style="padding-top:20px;text-align:center;font-size:11px;color:#bbb;">
                You are receiving this because you have an account on Cura.
              </td>
            </tr>

          </table>
        </td></tr>
      </table>
    </body>
    </html>
    """
  end

  defp summary_section(label, content_html) do
    """
    <tr>
      <td style="background:#fff;padding:0 32px;border-left:1px solid rgba(0,0,0,0.07);border-right:1px solid rgba(0,0,0,0.07);">
        <div style="padding:20px 0;border-bottom:1px solid rgba(0,0,0,0.05);">
          <p style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#b5471b;margin:0 0 12px;">#{label}</p>
          #{content_html}
        </div>
      </td>
    </tr>
    """
  end

  defp assessment_html(text) do
    """
    <p style="font-size:14px;color:#444;line-height:1.65;margin:0;background:#faf9f7;border-radius:8px;padding:12px 14px;border:1px solid rgba(0,0,0,0.05);">#{text}</p>
    """
  end

  defp diagnoses_html(diagnoses) do
    pills =
      Enum.map_join(diagnoses, " ", fn d ->
        primary = d["type"] == "primary"
        bg = if primary, do: "rgba(181,71,27,0.07)", else: "rgba(0,0,0,0.04)"
        color = if primary, do: "#b5471b", else: "#666"
        border = if primary, do: "rgba(181,71,27,0.18)", else: "rgba(0,0,0,0.1)"

        code =
          if d["icd_code"],
            do: " <span style='opacity:0.6;font-size:11px;'>#{d["icd_code"]}</span>",
            else: ""

        """
        <span style="display:inline-block;padding:5px 11px;border-radius:999px;font-size:13px;font-weight:500;
                     background:#{bg};color:#{color};border:1px solid #{border};margin-bottom:6px;">
          #{d["condition"]}#{code}
        </span>
        """
      end)

    "<div>#{pills}</div>"
  end

  defp checklist_html(items) do
    rows =
      Enum.map_join(items, "", fn item ->
        """
        <tr>
          <td style="padding:5px 0;vertical-align:top;width:18px;">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#b5471b;margin-top:5px;"></span>
          </td>
          <td style="padding:5px 0;font-size:14px;color:#444;line-height:1.5;">#{item}</td>
        </tr>
        """
      end)

    "<table cellpadding='0' cellspacing='0' style='width:100%;'>#{rows}</table>"
  end

  defp prescriptions_html(prescriptions) do
    Enum.map_join(prescriptions, "", fn rx ->
      details =
        [
          if(rx["dosage"], do: rx["dosage"]),
          if(rx["quantity"], do: "Qty: #{rx["quantity"]}"),
          if(rx["refills"], do: "Refills: #{rx["refills"]}"),
          if(rx["instructions"], do: rx["instructions"])
        ]
        |> Enum.filter(& &1)

      details_html =
        if details != [] do
          items =
            Enum.map_join(details, "", fn d ->
              "<span style='font-size:12px;color:#888;margin-right:10px;'>#{d}</span>"
            end)

          "<div style='margin-top:4px;'>#{items}</div>"
        else
          ""
        end

      """
      <div style="padding:10px 14px;border-radius:10px;border:1px solid rgba(0,0,0,0.07);margin-bottom:8px;background:#fafaf9;">
        <p style="font-size:14px;font-weight:600;color:#222;margin:0;">#{rx["name"]}</p>
        #{details_html}
      </div>
      """
    end)
  end

  defp follow_up_html(text) do
    """
    <div style="display:flex;align-items:flex-start;gap:10px;padding:11px 14px;border-radius:10px;background:#faf9f7;border:1px solid rgba(0,0,0,0.06);">
      <p style="font-size:14px;color:#444;margin:0;line-height:1.55;">#{text}</p>
    </div>
    """
  end

  defp seek_care_html(items) do
    rows =
      Enum.map_join(items, "", fn item ->
        """
        <div style="padding:9px 13px;border-radius:8px;background:rgba(181,71,27,0.05);border:1px solid rgba(181,71,27,0.12);margin-bottom:6px;">
          <p style="font-size:13px;color:#b5471b;margin:0;line-height:1.5;">#{item}</p>
        </div>
        """
      end)

    "<div>#{rows}</div>"
  end

  # ── HTML helpers ─────────────────────────────────────────────────────────────

  defp wrap(content) do
    """
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
    <body style="margin:0;padding:0;background:#f5f5f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f0;padding:40px 16px;">
        <tr><td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
            <!-- Logo -->
            <tr>
              <td style="padding-bottom:24px;">
                <span style="font-size:20px;font-weight:700;color:#b5471b;letter-spacing:-0.5px;">cura</span>
              </td>
            </tr>
            <!-- Card -->
            <tr>
              <td style="background:#fff;border-radius:16px;padding:36px;border:1px solid #e8e8e3;">
                #{content}
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="padding-top:24px;text-align:center;font-size:12px;color:#aaa;">
                Cura Health · You are receiving this because you have an account on Cura.
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>
    """
  end

  defp detail_table(rows) do
    cells =
      Enum.map_join(rows, "", fn {label, value} ->
        """
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#999;font-weight:500;white-space:nowrap;width:120px;">#{label}</td>
          <td style="padding:10px 16px;font-size:14px;color:#111;font-weight:500;">#{value}</td>
        </tr>
        """
      end)

    """
    <table cellpadding="0" cellspacing="0" style="width:100%;border-radius:10px;overflow:hidden;background:#faf9f7;border:1px solid #ece9e5;margin:20px 0;">
      #{cells}
    </table>
    """
  end

  defp cta(text, url) do
    """
    <div style="text-align:center;margin-top:28px;">
      <a href="#{url}" style="display:inline-block;padding:12px 28px;background:#b5471b;color:#fff;text-decoration:none;border-radius:999px;font-size:14px;font-weight:600;">
        #{text}
      </a>
    </div>
    """
  end

  defp h1, do: "font-size:22px;font-weight:700;color:#111;margin:0 0 12px;letter-spacing:-0.3px;"
  defp p, do: "font-size:14px;color:#555;line-height:1.6;margin:0 0 16px;"

  # ── Format helpers ────────────────────────────────────────────────────────────

  defp full_name(user), do: "#{user.first_name} #{user.last_name}"

  defp fmt_date(%Date{} = d), do: Calendar.strftime(d, "%B %d, %Y")

  defp fmt_date(d) when is_binary(d) do
    case Date.from_iso8601(d) do
      {:ok, date} -> fmt_date(date)
      _ -> d
    end
  end

  defp fmt_time(%Time{} = t) do
    h12 = rem(t.hour, 12)
    h12 = if h12 == 0, do: 12, else: h12
    min = String.pad_leading(Integer.to_string(t.minute), 2, "0")
    period = if t.hour >= 12, do: "PM", else: "AM"
    "#{h12}:#{min} #{period}"
  end

  defp fmt_time(t) when is_binary(t) do
    case Time.from_iso8601(t) do
      {:ok, time} -> fmt_time(time)
      _ -> t
    end
  end
end
