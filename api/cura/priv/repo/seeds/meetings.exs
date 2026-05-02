defmodule Cura.Repo.Seeds.Meetings do
  alias Cura.Accounts.User
  alias Cura.Meetings.Meeting
  alias Cura.Repo

  import Ecto.Query

  @durations [15, 30, 45, 60, 90, 120]
  @titles [
    "Initial Consultation",
    "Follow-up Visit",
    "Wellness Check",
    "Treatment Review",
    "Therapy Session",
    "Progress Update"
  ]
  @notes [
    "Bring previous test results if available.",
    "Patient requested a morning appointment.",
    "Reminder: discuss medication adherence.",
    "Check vitals and update care plan.",
    "Review lab results and next steps.",
    "General follow-up and Q&A."
  ]

  def run do
    case Repo.aggregate(Meeting, :count) do
      0 ->
        seed_meetings()

      _ ->
        IO.puts("Meetings already exist, skipping seeding.")
    end
  end

  def seed_meetings(meetings_per_doctor \\ 6) do
    # Sort by the numeric suffix in the seeded email ("doctor7@cura.pt" → 7) so
    # doctorN ends up at index N-1 regardless of insertion order. Lets the
    # pairing below stay stable across reseeds.
    doctors = Repo.all(from u in User, where: u.role == :doctor) |> Enum.sort_by(&seed_index/1)
    patients = Repo.all(from u in User, where: u.role == :patient) |> Enum.sort_by(&seed_index/1)

    cond do
      doctors == [] ->
        Mix.shell().error("No doctors found; seed users first.")

      patients == [] ->
        Mix.shell().error("No patients found; seed users first.")

      true ->
        base_date = Date.utc_today()

        doctors
        |> Enum.with_index(1)
        |> Enum.each(fn {doctor, doctor_index} ->
          # doctorN ↔ patientN — guaranteed pairing for manual testing.
          # Falls back to a random patient if there are more doctors than patients.
          paired_patient = Enum.at(patients, doctor_index - 1) || Enum.random(patients)

          Enum.each(1..meetings_per_doctor, fn meeting_index ->
            date = Date.add(base_date, doctor_index * 2 + meeting_index)
            time = Time.new!(8 + rem(meeting_index, 8), Enum.random([0, 30]), 0)

            # First meeting is always the paired patient so the deterministic
            # link is visible immediately; the rest stay random for variety.
            patient =
              if meeting_index == 1, do: paired_patient, else: Enum.random(patients)

            Repo.insert!(%Meeting{
              title: "#{Enum.random(@titles)}",
              date: date,
              time: time,
              duration: Enum.random(@durations),
              notes: Enum.random(@notes),
              timezone: "UTC",
              status: :scheduled,
              doctor_id: doctor.id,
              patient_id: patient.id
            })
          end)

          Enum.each(1..3, fn days_ago ->
            date = Date.add(base_date, -days_ago)
            time = Time.new!(9 + rem(days_ago + doctor_index, 8), Enum.random([0, 30]), 0)

            Repo.insert!(%Meeting{
              title: "#{Enum.random(@titles)}",
              date: date,
              time: time,
              duration: Enum.random(@durations),
              notes: Enum.random(@notes),
              timezone: "UTC",
              status: :completed,
              doctor_id: doctor.id,
              patient_id: Enum.random(patients).id
            })
          end)
        end)

        Mix.shell().info("Seeded meetings for #{length(doctors)} doctors.")
    end
  end

  defp seed_index(%User{email: email}) do
    case Regex.run(~r/(\d+)@/, email) do
      [_, n] -> String.to_integer(n)
      _ -> 0
    end
  end
end

Cura.Repo.Seeds.Meetings.run()
